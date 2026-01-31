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

const ALL_QUALITIES = [
    { name: '360p', height: 360, bitrate: '800k', bufsize: '1200k', audioBitrate: '96k' },
    { name: '480p', height: 480, bitrate: '1400k', bufsize: '2100k', audioBitrate: '128k' },
    { name: '720p', height: 720, bitrate: '2800k', bufsize: '4200k', audioBitrate: '128k' },
    { name: '1080p', height: 1080, bitrate: '5000k', bufsize: '7500k', audioBitrate: '192k' },
    { name: '1440p', height: 1440, bitrate: '9000k', bufsize: '13500k', audioBitrate: '192k' },
    { name: '2160p', height: 2160, bitrate: '17000k', bufsize: '25500k', audioBitrate: '192k' }
];

app.use(express.static('public'));

// Transcoding Function
// Transcoding Function
const transcodeVideo = (inputPath, outputDir, videoId, targetQualities, done) => {
    console.log(`Starting transcoding for ${inputPath} to Multi-Quality HLS...`);
    console.log(`Target Qualities: ${targetQualities ? targetQualities.join(', ') : 'Default (All)'}`);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Filter qualities based on user selection, or use all if none/invalid provided
    let selectedQualities = ALL_QUALITIES;
    if (targetQualities && targetQualities.length > 0) {
        selectedQualities = ALL_QUALITIES.filter(q => targetQualities.includes(q.name));
    }
    // Fallback if filtering resulted in empty (shouldn't happen if validation is good, but safety first)
    if (selectedQualities.length === 0) {
        selectedQualities = [ALL_QUALITIES[0]]; // Default to lowest quality
    }

    const ffmpegCommand = ffmpeg(inputPath);
    const options = [
        '-c:v h264',
        '-crf 22',
        '-g 48',
        '-keyint_min 48',
        '-sc_threshold 0',
        '-reset_timestamps 1',
        '-preset veryfast',
        '-c:a aac',
        '-ar 48000'
    ];

    const streamMap = [];

    selectedQualities.forEach((q, index) => {
        // Map streams
        options.push('-map 0:v:0', '-map 0:a:0');

        // Video Filters & Settings
        options.push(`-filter:v:${index} scale=w=-2:h=${q.height}`);
        options.push(`-maxrate:v:${index} ${q.bitrate}`, `-bufsize:v:${index} ${q.bufsize}`);

        // Audio Settings
        options.push(`-b:a:${index} ${q.audioBitrate}`);

        // Stream Map entry
        streamMap.push(`v:${index},a:${index}`);
    });

    options.push(
        '-f hls',
        '-hls_time 6',
        '-hls_playlist_type vod',
        '-hls_flags independent_segments',
        '-var_stream_map', streamMap.join(' '),
        '-master_pl_name master.m3u8',
        '-hls_segment_filename ' + path.join(outputDir, 'v%v_segment%d.ts')
    );

    ffmpegCommand
        .addOptions(options)
        .output(path.join(outputDir, 'v%v_code.m3u8'))

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
    let qualities = req.body.qualities;
    if (typeof qualities === 'string') {
        qualities = qualities.split(',');
    }
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
        transcodeVideo(req.file.path, outputDir, videoId, qualities, (err) => {
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

// GET all videos with Pagination and Search
app.get('/videos', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const skip = (page - 1) * limit;

        const where = {
            title: {
                contains: search,
                mode: 'insensitive', // Case-insensitive search
            },
        };

        const [videos, total] = await prisma.$transaction([
            prisma.video.findMany({
                where: where,
                orderBy: { createdAt: 'desc' },
                skip: skip,
                take: limit,
            }),
            prisma.video.count({ where: where }),
        ]);

        res.json({
            data: videos,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        });
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
server.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);

    // Crash Recovery: Mark stuck 'processing' videos as 'failed'
    try {
        const result = await prisma.video.updateMany({
            where: { status: 'processing' },
            data: { status: 'failed' }
        });
        if (result.count > 0) {
            console.log(`Crash recovery: Marked ${result.count} stuck videos as 'failed'.`);
        }
    } catch (error) {
        console.error("Error during crash recovery:", error);
    }
});
