const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const { PrismaClient } = require('@prisma/client');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const prisma = new PrismaClient();

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
const transcodeVideo = (inputPath, outputDir, videoId, done) => {
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
        .on('end', async () => {
            console.log('Transcoding finished successfully');
            try {
                await prisma.video.update({
                    where: { id: videoId },
                    data: { status: 'finished' }
                });
                io.emit('video_updated', { id: videoId, status: 'finished' });
            } catch (err) {
                console.error('Error updating status:', err);
            }
            done(null);
        })
        .on('error', async (err) => {
            console.error('Error transcoding:', err);
            try {
                await prisma.video.update({
                    where: { id: videoId },
                    data: { status: 'failed' }
                });
                io.emit('video_updated', { id: videoId, status: 'failed' });
            } catch (dbErr) {
                console.error('Error updating status:', dbErr);
            }
            done(err);
        })
        .run();
};

// Upload Endpoint
app.post('/upload', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const filename = req.file.filename;
    // We can use the filename as ID or generate a new UUID. 
    // Prisma generates UUIDs for us if we don't provide ID, but we want to associate it immediately.
    // Let's create the record first to get the ID.

    try {
        const video = await prisma.video.create({
            data: {
                title: req.file.originalname,
                filename: filename,
                status: 'processing'
            }
        });

        const videoId = video.id; // Use UUID from DB
        const outputDir = path.join(publicDir, 'videos', videoId);

        console.log(`Video uploaded: ${req.file.path}`);

        // In a real app, you would use a queue (BullMQ) here.
        // For POC, we start transcoding immediately but asynchronously.
        transcodeVideo(req.file.path, outputDir, videoId, (err) => {
            if (err) {
                console.error('Transcoding failed');
            } else {
                console.log(`Video available at /videos/${videoId}/master.m3u8`);
            }
        });

        res.json({
            message: 'Video upload started. Transcoding in progress...',
            videoId: videoId,
            status: 'processing'
        });
    } catch (error) {
        console.error("Error creating video record:", error);
        res.status(500).send("Database error");
    }
});

// GET all videos
app.get('/videos', async (req, res) => {
    try {
        const videos = await prisma.video.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(videos);
    } catch (error) {
        console.error("Error fetching videos:", error);
        res.status(500).send("Error fetching videos");
    }
});

// DELETE video
app.delete('/videos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const video = await prisma.video.findUnique({ where: { id } });
        if (!video) {
            return res.status(404).send("Video not found");
        }

        // Optional: Check if processing (or allow force delete)
        // if (video.status === 'processing') {
        //     return res.status(400).send("Cannot delete while processing");
        // }

        await prisma.video.delete({ where: { id } });

        // Delete files
        // 1. Delete original upload (if we kept it there, but Multer puts it in 'videos/temp' with a generated name)
        // logic for deleting original file might need the path if we want to be strict.
        // req.file.path was uploadDir + filename.
        const originalPath = path.join(uploadDir, video.filename);
        if (fs.existsSync(originalPath)) {
            fs.unlinkSync(originalPath);
        }

        // 2. Delete HLS output folder
        const hlsDir = path.join(publicDir, 'videos', id);
        if (fs.existsSync(hlsDir)) {
            fs.rmSync(hlsDir, { recursive: true, force: true });
        }

        io.emit('video_deleted', { id });
        res.send("Video deleted successfully");

    } catch (error) {
        console.error("Error deleting video:", error);
        res.status(500).send("Error deleting video");
    }
});

const PORT = 4000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
