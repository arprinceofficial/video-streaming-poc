const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

ffmpeg()
    .input('testsrc=duration=5:size=1280x720:rate=30')
    .inputFormat('lavfi')
    .output('test_video.mp4')
    .videoCodec('libx264')
    .on('end', () => console.log('Dummy video created: test_video.mp4'))
    .on('error', (err) => console.error('Error creating video:', err))
    .run();
