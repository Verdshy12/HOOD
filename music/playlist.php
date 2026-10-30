<?php
/**
 * HOOD Radio — music/playlist.php
 *
 * Serves the song catalogue as JSON. The song list itself lives in
 * music/playlist.json (single source of truth); this script adds a
 * server-side check that each audio file really exists in
 * /Files/Media/music/ (case-sensitive, exactly like Linux hosting).
 *
 * radio.js falls back to reading playlist.json directly when PHP is not
 * available (for example on a static Vercel deployment).
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

const AUDIO_RE = '/^[A-Za-z0-9][A-Za-z0-9._-]*\.(mp3|ogg|oga|opus|m4a|aac|wav|flac)$/';
const IMAGE_RE = '/^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpe?g|png|webp|gif|svg)$/';

$musicDir = dirname(__DIR__) . '/Files/Media/music/';
$source   = __DIR__ . '/playlist.json';

function respond_error(int $status, string $message)
{
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

$raw = @file_get_contents($source);
if ($raw === false) {
    respond_error(500, 'playlist.json could not be read');
}

$data = json_decode($raw, true);
if (!is_array($data) || !isset($data['tracks']) || !is_array($data['tracks'])) {
    respond_error(500, 'playlist.json is not valid: expected {"tracks": [...]}');
}

$tracks = [];
foreach ($data['tracks'] as $entry) {
    if (!is_array($entry) || !isset($entry['file']) || !is_string($entry['file'])) {
        continue;
    }

    $file = $entry['file'];
    if (!preg_match(AUDIO_RE, $file)) {
        continue; // rejects paths, "..", odd characters
    }

    $art = null;
    if (isset($entry['art']) && is_string($entry['art'])
        && preg_match(IMAGE_RE, $entry['art'])
        && is_file($musicDir . $entry['art'])) {
        $art = $entry['art'];
    }

    $tracks[] = [
        'title'     => isset($entry['title'])  ? (string) $entry['title']  : $file,
        'artist'    => isset($entry['artist']) ? (string) $entry['artist'] : 'Unknown artist',
        'file'      => $file,
        'art'       => $art,
        'duration'  => isset($entry['duration']) && is_numeric($entry['duration'])
                         ? (float) $entry['duration'] : null,
        // is_file() is case-sensitive on Linux: "Song.mp3" != "song.mp3".
        'available' => is_file($musicDir . $file),
    ];
}

echo json_encode(
    ['source' => 'php', 'tracks' => $tracks],
    JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
);
