const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());

// Ensure directories exist
const uploadDir = path.join(__dirname, 'videos', 'temp');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

// Configure Multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

app.use(express.static('public'));

// Transcoding Function
// Transcoding Function
const transcodeVideo = (inputPath, outputDir, done) => {
    console.log(`Starting transcoding for ${inputPath} to Multi-Quality HLS...`);

    // Ensure output directory exists (and subdirectories for variants if needed, 
    // but ffmpeg var_stream_map with pattern usually handles this if parent exists. 
    // Safest is to let ffmpeg create files in the outputDir).
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Create a robust ffmpeg command for ABR
    ffmpeg(inputPath)
        .addOptions([
            // Map the video and audio streams 6 times (for 6 qualities)
            '-map 0:v:0', '-map 0:a:0', // 360p
            '-map 0:v:0', '-map 0:a:0', // 480p
            '-map 0:v:0', '-map 0:a:0', // 720p
            '-map 0:v:0', '-map 0:a:0', // 1080p
            '-map 0:v:0', '-map 0:a:0', // 1440p (2K)
            '-map 0:v:0', '-map 0:a:0', // 2160p (4K)

            // Video codec
            '-c:v h264',
            '-crf 22',
            '-g 48',
            '-keyint_min 48',
            '-sc_threshold 0',
            '-reset_timestamps 1',
            '-preset veryfast', // Speed up encoding for 4K

            // Audio codec
            '-c:a aac',
            '-ar 48000',

            // --- 360p Stream (Stream 0) ---
            '-filter:v:0 scale=w=-2:h=360',
            '-maxrate:v:0 800k', '-bufsize:v:0 1200k',
            '-b:a:0 96k',

            // --- 480p Stream (Stream 1) ---
            '-filter:v:1 scale=w=-2:h=480',
            '-maxrate:v:1 1400k', '-bufsize:v:1 2100k',
            '-b:a:1 128k',

            // --- 720p Stream (Stream 2) ---
            '-filter:v:2 scale=w=-2:h=720',
            '-maxrate:v:2 2800k', '-bufsize:v:2 4200k',
            '-b:a:2 128k',

            // --- 1080p Stream (Stream 3) ---
            '-filter:v:3 scale=w=-2:h=1080',
            '-maxrate:v:3 5000k', '-bufsize:v:3 7500k',
            '-b:a:3 192k',

            // --- 1440p Stream (Stream 4) ---
            '-filter:v:4 scale=w=-2:h=1440',
            '-maxrate:v:4 9000k', '-bufsize:v:4 13500k',
            '-b:a:4 192k',

            // --- 2160p Stream (Stream 5) ---
            '-filter:v:5 scale=w=-2:h=2160',
            '-maxrate:v:5 17000k', '-bufsize:v:5 25500k',
            '-b:a:5 192k',

            // HLS Settings
            '-f hls',
            '-hls_time 6',
            '-hls_playlist_type vod',
            '-hls_flags independent_segments',

            // Creating the variant streams and master playlist
            '-var_stream_map', 'v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3 v:4,a:4 v:5,a:5',

            // Naming convention for the segments and playlists
            // outputDir/v0/fileSequence0.ts, outputDir/v1/..., etc.
            // But to keep it simple in one folder or use pattern:
            // We'll use a pattern that creates subdirectories v%v (v0, v1, v2)
            // You may need to create these folders manually if ffmpeg doesn't.
            // Let's use a flat structure with prefixes to be safe and simple:
            // v0_segment...
            // OR robust usage with "%v":

            '-master_pl_name master.m3u8',
            '-hls_segment_filename ' + path.join(outputDir, 'v%v_segment%d.ts')
        ])
        .output(path.join(outputDir, 'v%v_code.m3u8')) // Variant playlists
        .on('start', function (commandLine) {
            console.log('Spawned Ffmpeg with command: ' + commandLine);
        })
        .on('end', () => {
            console.log('Transcoding finished successfully');
            done(null);
        })
        .on('error', (err) => {
            console.error('Error transcoding:', err);
            done(err);
        })
        .run();
};

// Upload Endpoint
app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const videoId = req.file.filename.split('.')[0];
    const outputDir = path.join(publicDir, 'videos', videoId);

    console.log(`Video uploaded: ${req.file.path}`);

    // In a real app, you would use a queue (BullMQ) here.
    // For POC, we start transcoding immediately but asynchronously.
    transcodeVideo(req.file.path, outputDir, (err) => {
        if (err) {
            console.error('Transcoding failed');
        } else {
            console.log(`Video available at /videos/${videoId}/master.m3u8`);
        }
    });

    res.json({
        message: 'Video upload started. Transcoding in progress...',
        videoId: videoId,
        streamUrl: `/videos/${videoId}/master.m3u8` // Point to MASTER playlist
    });
});

const PORT = 4000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
