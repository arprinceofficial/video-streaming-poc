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
const transcodeVideo = (inputPath, outputDir, done) => {
    console.log(`Starting transcoding for ${inputPath}...`);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Example: Create 720p HLS stream
    ffmpeg(inputPath)
        .addOptions([
            '-profile:v main',
            '-vf scale=w=1280:h=720:force_original_aspect_ratio=decrease',
            '-c:a aac',
            '-ar 48000',
            '-b:a 128k',
            '-c:v h264',
            '-crf 20',
            '-g 48',
            '-keyint_min 48',
            '-sc_threshold 0',
            '-start_number 0',
            '-hls_time 4',
            '-hls_list_size 0',
            '-f hls'
        ])
        .output(path.join(outputDir, 'output.m3u8'))
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
            console.log(`Video available at /videos/${videoId}/output.m3u8`);
        }
    });

    res.json({
        message: 'Video upload started. Transcoding in progress...',
        videoId: videoId,
        streamUrl: `/videos/${videoId}/output.m3u8` // This URL will be valid once transcoding finishes
    });
});

const PORT = 4000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
