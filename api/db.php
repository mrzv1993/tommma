<?php
declare(strict_types=1);

$config = require __DIR__ . '/config.php';

$required = ['db_host', 'db_name', 'db_user', 'db_pass'];
foreach ($required as $key) {
    if (!array_key_exists($key, $config) || $config[$key] === '') {
        throw new RuntimeException("Missing DB config key: {$key}");
    }
}

$dsn = sprintf(
    'mysql:host=%s;dbname=%s;charset=utf8mb4',
    $config['db_host'],
    $config['db_name']
);

return new PDO($dsn, $config['db_user'], $config['db_pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
