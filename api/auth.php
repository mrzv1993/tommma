<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    $decoded = json_decode((string) $raw, true);
    return is_array($decoded) ? $decoded : [];
}

function normalizedEmail(string $email): string
{
    return strtolower(trim($email));
}

function normalizedNickname(string $nickname): string
{
    return trim($nickname);
}

function validateNickname(string $nickname): bool
{
    return (bool) preg_match('/^[A-Za-z0-9]{3,32}$/', $nickname);
}

function generateVerificationCode(): string
{
    return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
}

function encodeHeaderUtf8(string $value): string
{
    return '=?UTF-8?B?' . base64_encode($value) . '?=';
}

function resolveMailAddress(string $candidate, string $fallback): string
{
    return filter_var($candidate, FILTER_VALIDATE_EMAIL) ? $candidate : $fallback;
}

function containsText(string $haystack, string $needle): bool
{
    return strpos($haystack, $needle) !== false;
}

function requestHost(): string
{
    $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
    $host = explode(':', $host)[0] ?: 'localhost';
    return strtolower($host);
}

function isLocalRequest(): bool
{
    $host = requestHost();
    if (in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
        return true;
    }
    if (str_ends_with($host, '.local') || str_ends_with($host, '.localhost') || str_ends_with($host, '.test')) {
        return true;
    }
    if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
        return str_starts_with($host, '10.')
            || str_starts_with($host, '192.168.')
            || preg_match('/^172\.(1[6-9]|2[0-9]|3[0-1])\./', $host) === 1;
    }
    return false;
}

function ensureLocalTestUser(PDO $pdo): int
{
    $nickname = 'testuser';
    $email = 'testuser@local.test';
    $passwordHash = password_hash('Test12345', PASSWORD_DEFAULT);

    $select = $pdo->prepare('SELECT id FROM users WHERE nickname = :nickname OR email = :email LIMIT 1');
    $select->execute([
        'nickname' => $nickname,
        'email' => $email,
    ]);
    $existingId = $select->fetchColumn();

    if ($existingId !== false) {
        $update = $pdo->prepare(
            'UPDATE users
             SET nickname = :nickname,
                 email = :email,
                 password_hash = :password_hash,
                 email_verified_at = NOW(),
                 verification_code_hash = NULL,
                 verification_expires_at = NULL,
                 verification_sent_at = NULL
             WHERE id = :id'
        );
        $update->execute([
            'id' => (int) $existingId,
            'nickname' => $nickname,
            'email' => $email,
            'password_hash' => $passwordHash,
        ]);
        return (int) $existingId;
    }

    $insert = $pdo->prepare(
        'INSERT INTO users (nickname, email, password_hash, email_verified_at)
         VALUES (:nickname, :email, :password_hash, NOW())'
    );
    $insert->execute([
        'nickname' => $nickname,
        'email' => $email,
        'password_hash' => $passwordHash,
    ]);

    return (int) $pdo->lastInsertId();
}

function sendVerificationCodeEmail(string $toEmail, string $code, array $config): bool
{
    $subject = encodeHeaderUtf8('Код подтверждения Tommma');
    $message = "Ваш код подтверждения: {$code}\n\nКод действует 15 минут.";
    $host = requestHost();
    $fallbackFrom = 'no-reply@' . preg_replace('/[^a-z0-9.-]/i', '', $host);

    $fromEmail = resolveMailAddress((string) ($config['mail_from'] ?? ''), $fallbackFrom);
    $fromName = trim((string) ($config['mail_from_name'] ?? 'Tommma')) ?: 'Tommma';
    $returnPath = resolveMailAddress((string) ($config['mail_return_path'] ?? ''), $fromEmail);

    $headers = [
        'MIME-Version: 1.0',
        'Content-type: text/plain; charset=UTF-8',
        'From: ' . encodeHeaderUtf8($fromName) . " <{$fromEmail}>",
        "Reply-To: {$fromEmail}",
        'X-Mailer: PHP/' . PHP_VERSION,
    ];

    $result = @mail($toEmail, $subject, $message, implode("\r\n", $headers), "-f{$returnPath}");
    if (!$result) {
        error_log("tommma mail() failed for {$toEmail}, from={$fromEmail}, returnPath={$returnPath}");
    }
    return $result;
}

function currentUser(PDO $pdo): ?array
{
    $userId = $_SESSION['user_id'] ?? null;
    if (!is_int($userId) && !ctype_digit((string) $userId)) {
        return null;
    }

    $stmt = $pdo->prepare('SELECT id, nickname, email, email_verified_at FROM users WHERE id = :id LIMIT 1');
    $stmt->execute(['id' => (int) $userId]);
    $user = $stmt->fetch();
    return is_array($user) ? $user : null;
}

session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
]);
session_start();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';

if (isLocalRequest() && $method === 'GET' && $action === 'session' && !empty($_SESSION['local_test_user'])) {
    respond(200, ['ok' => true, 'user' => $_SESSION['local_test_user']]);
}

if (isLocalRequest() && $method === 'POST' && $action === 'login') {
    $body = readJsonBody();
    $login = trim((string) ($body['login'] ?? ''));
    $password = (string) ($body['password'] ?? '');

    if ($login === 'testuser' && $password === 'Test12345') {
        $_SESSION['local_test_user'] = [
            'id' => 'local-test',
            'nickname' => 'testuser',
            'email' => 'testuser@local.test',
            'email_verified_at' => date('Y-m-d H:i:s'),
        ];
        unset($_SESSION['user_id'], $_SESSION['pending_verify_user_id']);
        respond(200, ['ok' => true, 'testAccount' => true, 'localMode' => true]);
    }
}

if (isLocalRequest() && $method === 'POST' && $action === 'logout' && !empty($_SESSION['local_test_user'])) {
    unset($_SESSION['local_test_user'], $_SESSION['user_id'], $_SESSION['pending_verify_user_id']);
    session_regenerate_id(true);
    respond(200, ['ok' => true]);
}

try {
    $appConfig = require __DIR__ . '/config.php';
    /** @var PDO $pdo */
    $pdo = require __DIR__ . '/db.php';
} catch (Throwable $e) {
    respond(500, ['ok' => false, 'error' => 'DB connection failed']);
}

if ($method === 'GET' && $action === 'session') {
    $user = currentUser($pdo);
    respond(200, ['ok' => true, 'user' => $user]);
}

if ($method === 'POST' && $action === 'register') {
    $body = readJsonBody();
    $nickname = normalizedNickname((string) ($body['nickname'] ?? ''));
    $email = normalizedEmail((string) ($body['email'] ?? ''));
    $password = (string) ($body['password'] ?? '');

    if (!validateNickname($nickname)) {
        respond(400, ['ok' => false, 'error' => 'Никнейм: только латиница и цифры, 3-32 символа']);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(400, ['ok' => false, 'error' => 'Некорректный email']);
    }
    if (strlen($password) < 8) {
        respond(400, ['ok' => false, 'error' => 'Пароль должен быть минимум 8 символов']);
    }

    try {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email OR nickname = :nickname LIMIT 1');
        $stmt->execute(['email' => $email, 'nickname' => $nickname]);
        if ($stmt->fetch()) {
            respond(409, ['ok' => false, 'error' => 'Пользователь с таким email или никнеймом уже существует']);
        }

        $pdo->beginTransaction();

        $code = generateVerificationCode();
        $codeHash = password_hash($code, PASSWORD_DEFAULT);
        $passwordHash = password_hash($password, PASSWORD_DEFAULT);
        $expiresAt = (new DateTimeImmutable('+15 minutes'))->format('Y-m-d H:i:s');
        $sentAt = (new DateTimeImmutable())->format('Y-m-d H:i:s');

        $insert = $pdo->prepare(
            'INSERT INTO users (nickname, email, password_hash, verification_code_hash, verification_expires_at, verification_sent_at)
             VALUES (:nickname, :email, :password_hash, :code_hash, :expires_at, :sent_at)'
        );
        $insert->execute([
            'nickname' => $nickname,
            'email' => $email,
            'password_hash' => $passwordHash,
            'code_hash' => $codeHash,
            'expires_at' => $expiresAt,
            'sent_at' => $sentAt,
        ]);

        $userId = (int) $pdo->lastInsertId();
        $_SESSION['pending_verify_user_id'] = $userId;
        unset($_SESSION['user_id']);

        if (!sendVerificationCodeEmail($email, $code, $appConfig)) {
            $pdo->rollBack();
            unset($_SESSION['pending_verify_user_id']);
            respond(500, ['ok' => false, 'error' => 'Не удалось отправить код на почту']);
        }

        $pdo->commit();
        respond(200, ['ok' => true, 'email' => $email]);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        $message = (string) $e->getMessage();
        if (
            containsText($message, 'Base table or view not found') ||
            containsText($message, 'Unknown column')
        ) {
            respond(500, ['ok' => false, 'error' => 'Не настроена схема БД. Выполните SQL из database.sql']);
        }
        respond(500, ['ok' => false, 'error' => 'Не удалось зарегистрироваться']);
    }
}

if ($method === 'POST' && $action === 'verify') {
    $pendingUserId = $_SESSION['pending_verify_user_id'] ?? null;
    if (!is_int($pendingUserId) && !ctype_digit((string) $pendingUserId)) {
        respond(401, ['ok' => false, 'error' => 'Сессия подтверждения не найдена']);
    }

    $body = readJsonBody();
    $code = trim((string) ($body['code'] ?? ''));
    if (!preg_match('/^\d{6}$/', $code)) {
        respond(400, ['ok' => false, 'error' => 'Код должен состоять из 6 цифр']);
    }

    try {
        $stmt = $pdo->prepare(
            'SELECT id, verification_code_hash, verification_expires_at FROM users WHERE id = :id LIMIT 1'
        );
        $stmt->execute(['id' => (int) $pendingUserId]);
        $user = $stmt->fetch();
        if (!$user) {
            respond(404, ['ok' => false, 'error' => 'Пользователь не найден']);
        }

        $expiresAt = $user['verification_expires_at'] ?? null;
        if (!$expiresAt || strtotime((string) $expiresAt) < time()) {
            respond(400, ['ok' => false, 'error' => 'Срок действия кода истек']);
        }

        $hash = (string) ($user['verification_code_hash'] ?? '');
        if ($hash === '' || !password_verify($code, $hash)) {
            respond(400, ['ok' => false, 'error' => 'Неверный код']);
        }

        $update = $pdo->prepare(
            'UPDATE users
             SET email_verified_at = NOW(),
                 verification_code_hash = NULL,
                 verification_expires_at = NULL,
                 verification_sent_at = NULL
             WHERE id = :id'
        );
        $update->execute(['id' => (int) $pendingUserId]);

        $_SESSION['user_id'] = (int) $pendingUserId;
        unset($_SESSION['pending_verify_user_id']);

        respond(200, ['ok' => true]);
    } catch (Throwable $e) {
        respond(500, ['ok' => false, 'error' => 'Не удалось подтвердить email']);
    }
}

if ($method === 'POST' && $action === 'resend') {
    $pendingUserId = $_SESSION['pending_verify_user_id'] ?? null;
    if (!is_int($pendingUserId) && !ctype_digit((string) $pendingUserId)) {
        respond(401, ['ok' => false, 'error' => 'Сессия подтверждения не найдена']);
    }

    try {
        $stmt = $pdo->prepare('SELECT id, email, verification_sent_at FROM users WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => (int) $pendingUserId]);
        $user = $stmt->fetch();
        if (!$user) {
            respond(404, ['ok' => false, 'error' => 'Пользователь не найден']);
        }

        $sentAt = $user['verification_sent_at'] ?? null;
        if ($sentAt && (time() - strtotime((string) $sentAt)) < 30) {
            respond(429, ['ok' => false, 'error' => 'Повторная отправка доступна через 30 секунд']);
        }

        $code = generateVerificationCode();
        $codeHash = password_hash($code, PASSWORD_DEFAULT);
        $expiresAt = (new DateTimeImmutable('+15 minutes'))->format('Y-m-d H:i:s');

        $update = $pdo->prepare(
            'UPDATE users
             SET verification_code_hash = :code_hash,
                 verification_expires_at = :expires_at,
                 verification_sent_at = NOW()
             WHERE id = :id'
        );
        $update->execute([
            'code_hash' => $codeHash,
            'expires_at' => $expiresAt,
            'id' => (int) $pendingUserId,
        ]);

        if (!sendVerificationCodeEmail((string) $user['email'], $code, $appConfig)) {
            respond(500, ['ok' => false, 'error' => 'Не удалось отправить код на почту']);
        }

        respond(200, ['ok' => true]);
    } catch (Throwable $e) {
        respond(500, ['ok' => false, 'error' => 'Не удалось отправить код']);
    }
}

if ($method === 'POST' && $action === 'login') {
    $body = readJsonBody();
    $login = trim((string) ($body['login'] ?? ''));
    $password = (string) ($body['password'] ?? '');

    if ($login === '' || $password === '') {
        respond(400, ['ok' => false, 'error' => 'Заполните логин и пароль']);
    }

    try {
        if (isLocalRequest() && $login === 'testuser' && $password === 'Test12345') {
            $testUserId = ensureLocalTestUser($pdo);
            $_SESSION['user_id'] = $testUserId;
            unset($_SESSION['pending_verify_user_id']);
            respond(200, ['ok' => true, 'testAccount' => true]);
        }

        $stmt = $pdo->prepare(
            'SELECT id, email, password_hash, email_verified_at
             FROM users
             WHERE email = :login OR nickname = :login
             LIMIT 1'
        );
        $stmt->execute(['login' => normalizedEmail($login)]);
        $user = $stmt->fetch();
        if (!$user) {
            $stmt = $pdo->prepare(
                'SELECT id, email, password_hash, email_verified_at
                 FROM users
                 WHERE nickname = :login
                 LIMIT 1'
            );
            $stmt->execute(['login' => $login]);
            $user = $stmt->fetch();
        }

        if (!$user || !password_verify($password, (string) $user['password_hash'])) {
            respond(401, ['ok' => false, 'error' => 'Неверный логин или пароль']);
        }

        if (empty($user['email_verified_at'])) {
            $_SESSION['pending_verify_user_id'] = (int) $user['id'];
            unset($_SESSION['user_id']);
            respond(403, [
                'ok' => false,
                'error' => 'Подтвердите email',
                'requireVerification' => true,
                'email' => (string) ($user['email'] ?? ''),
            ]);
        }

        $_SESSION['user_id'] = (int) $user['id'];
        unset($_SESSION['pending_verify_user_id']);

        respond(200, ['ok' => true]);
    } catch (Throwable $e) {
        respond(500, ['ok' => false, 'error' => 'Не удалось выполнить вход']);
    }
}

if ($method === 'POST' && $action === 'logout') {
    unset($_SESSION['user_id'], $_SESSION['pending_verify_user_id']);
    session_regenerate_id(true);
    respond(200, ['ok' => true]);
}

respond(405, ['ok' => false, 'error' => 'Method not allowed']);
