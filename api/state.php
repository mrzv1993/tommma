<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
const MAX_STATE_BODY_BYTES = 2000000;

function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
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

function respondServerError(string $publicMessage, Throwable $error): void
{
    error_log(sprintf(
        '[state.php] %s: %s in %s:%d',
        $publicMessage,
        $error->getMessage(),
        $error->getFile(),
        $error->getLine()
    ));

    if (isLocalRequest()) {
        respond(500, [
            'ok' => false,
            'error' => $publicMessage,
            'debug' => [
                'message' => $error->getMessage(),
                'file' => basename($error->getFile()),
                'line' => $error->getLine(),
            ],
        ]);
    }

    respond(500, ['ok' => false, 'error' => $publicMessage]);
}

function startSession(): void
{
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    ]);
    session_start();
}

function requireAuthenticatedUserId(): int
{
    $userId = $_SESSION['user_id'] ?? null;
    if (!is_int($userId) && !ctype_digit((string) $userId)) {
        respond(401, ['ok' => false, 'error' => 'Unauthorized']);
    }

    return (int) $userId;
}

function clearSessionAndRespondUnauthorized(string $message = 'Unauthorized'): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
    respond(401, ['ok' => false, 'error' => $message]);
}

function ensureUserExists(PDO $pdo, int $userId): void
{
    $stmt = $pdo->prepare('SELECT id FROM users WHERE id = :id LIMIT 1');
    $stmt->execute(['id' => $userId]);
    $row = $stmt->fetch();
    if (!$row) {
        clearSessionAndRespondUnauthorized('Session is invalid');
    }
}

function isValidTask(array $task): bool
{
    if (!isset($task['id']) || !is_string($task['id']) || trim($task['id']) === '') {
        return false;
    }
    if (!isset($task['title']) || !is_string($task['title'])) {
        return false;
    }
    if (!isset($task['columnId']) || !is_string($task['columnId']) || trim($task['columnId']) === '') {
        return false;
    }

    if (array_key_exists('plannedMinutes', $task) && $task['plannedMinutes'] !== null && !is_numeric($task['plannedMinutes'])) {
        return false;
    }
    if (array_key_exists('actualMinutes', $task) && !is_numeric($task['actualMinutes'])) {
        return false;
    }
    if (array_key_exists('sessionSeconds', $task) && !is_numeric($task['sessionSeconds'])) {
        return false;
    }
    if (array_key_exists('subtasks', $task)) {
        if (!is_array($task['subtasks'])) {
            return false;
        }

        foreach ($task['subtasks'] as $subtask) {
            if (!is_array($subtask)) {
                return false;
            }
            if (!isset($subtask['id']) || !is_string($subtask['id']) || trim($subtask['id']) === '') {
                return false;
            }
            if (!isset($subtask['title']) || !is_string($subtask['title'])) {
                return false;
            }
            if (array_key_exists('completed', $subtask) && !is_bool($subtask['completed'])) {
                return false;
            }
            if (array_key_exists('createdAt', $subtask) && !is_numeric($subtask['createdAt'])) {
                return false;
            }
        }
    }

    return true;
}

function isValidStatePayload(array $payload): bool
{
    if (!isset($payload['tasks']) || !is_array($payload['tasks'])) {
        return false;
    }

    foreach ($payload['tasks'] as $task) {
        if (!is_array($task) || !isValidTask($task)) {
            return false;
        }
    }

    return true;
}

function loadStatePayloadFromRequest(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        respond(400, ['ok' => false, 'error' => 'Request body is empty']);
    }

    if (strlen($raw) > MAX_STATE_BODY_BYTES) {
        respond(413, ['ok' => false, 'error' => 'State payload is too large']);
    }

    try {
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        respond(400, ['ok' => false, 'error' => 'Invalid JSON payload']);
    }

    if (!is_array($decoded) || !isValidStatePayload($decoded)) {
        respond(422, ['ok' => false, 'error' => 'Invalid state payload']);
    }

    return $decoded;
}

function fetchState(PDO $pdo, int $userId): ?array
{
    $stmt = $pdo->prepare('SELECT state_json FROM app_state WHERE user_id = :user_id LIMIT 1');
    $stmt->execute(['user_id' => $userId]);
    $row = $stmt->fetch();
    if (!$row || !isset($row['state_json'])) {
        return null;
    }

    try {
        $decoded = json_decode((string) $row['state_json'], true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        return null;
    }

    return is_array($decoded) ? $decoded : null;
}

function saveState(PDO $pdo, int $userId, array $state): void
{
    $stateJson = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

    $stmt = $pdo->prepare(
        'INSERT INTO app_state (user_id, state_json) VALUES (:user_id, :state_json)
         ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)'
    );
    $stmt->execute([
        'user_id' => $userId,
        'state_json' => $stateJson,
    ]);
}

startSession();

try {
    /** @var PDO $pdo */
    $pdo = require __DIR__ . '/db.php';
} catch (Throwable $e) {
    respondServerError('DB connection failed', $e);
}

$userId = requireAuthenticatedUserId();
ensureUserExists($pdo, $userId);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    try {
        $state = fetchState($pdo, $userId);
        respond(200, ['ok' => true, 'state' => $state]);
    } catch (Throwable $e) {
        respondServerError('Failed to load state', $e);
    }
}

if ($method === 'POST') {
    $state = loadStatePayloadFromRequest();

    try {
        saveState($pdo, $userId, $state);
        respond(200, ['ok' => true]);
    } catch (Throwable $e) {
        respondServerError('Failed to save state', $e);
    }
}

respond(405, ['ok' => false, 'error' => 'Method not allowed']);
