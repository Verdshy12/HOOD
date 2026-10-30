<?php
/**
 * HOOD Radio — music/radio.php
 *
 * Standalone player page. Open /music/radio.php on a PHP host to test the
 * radio without loading the driving game. The game itself does NOT need
 * this file: it loads music/radio.css and music/radio.js directly.
 */
declare(strict_types=1);

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');

// Cache-busting: the URL changes whenever the file changes.
$ver = static function (string $file): string {
    $time = @filemtime(__DIR__ . '/' . $file);
    return (string) ($time ?: 0);
};
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HOOD Radio · Standalone</title>
  <link rel="stylesheet" href="radio.css?v=<?= $ver('radio.css') ?>">
  <style>
    body { margin: 0; min-height: 100vh; background: #05080c; color: #c4d0d9;
           font-family: Arial, sans-serif; display: grid; place-items: center; }
    main { max-width: 460px; padding: 24px; text-align: center; line-height: 1.6; }
    h1   { color: #20c8ff; letter-spacing: 3px; font-size: 20px; }
    kbd  { border: 1px solid #20c8ff88; border-radius: 4px; padding: 1px 6px; color: #fff; }
  </style>
</head>
<body>
  <main>
    <h1>HOOD RADIO</h1>
    <p>Standalone test page. Press <kbd>R</kbd> to open the playlist,
       <kbd>Esc</kbd> to close it, <kbd>[</kbd> / <kbd>]</kbd> for previous / next.</p>
    <p>Nothing plays until you choose a song.</p>
  </main>

  <div id="hood-radio"></div>

  <script>window.HOOD_RADIO_STANDALONE = true;</script>
  <script type="module" src="radio.js?v=<?= $ver('radio.js') ?>"></script>
</body>
</html>
