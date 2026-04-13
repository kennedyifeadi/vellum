const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegStatic);

const inputPath = 'test.mp4';
const outputPath = 'output2.mp4';
const crf = 28;

let command = ffmpeg(inputPath).outputOptions([`-crf ${crf}`]);

command
  .on('end', () => console.log('Done'))
  .on('error', (err) => console.error('FFmpeg Error:', err))
  .save(outputPath);
