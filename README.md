# Video Streaming POC

A Proof of Concept (POC) for a video streaming backend similar to YouTube, built with Node.js. This application handles video uploads, transcodes them into HLS (HTTP Live Streaming) format using FFmpeg, and streams them back to the client.

## Features

- **Video Upload**: Upload video files (MP4) via a simple web interface.
- **Transcoding**: Automatically converts uploaded videos to HLS format (m3u8) with a 720p profile.
- **Streaming**: Plays back the HLS stream using `hls.js`.
- **Backend**: built with Express.js and `fluent-ffmpeg`.

## Prerequisites

- **Node.js**: (v14 or higher recommended)
- **NPM**: Included with Node.js.
- **System Dependencies**: The project uses `ffmpeg-static`, so a local FFmpeg installation is not strictly required for the app to run, but having standard libraries is good practice.

## Installation

1. Clone the repository (or unzip the project files).
2. Navigate to the project directory:
   ```bash
   cd video-streaming-poc
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Running the Application

1. Start the development server:
   ```bash
   npm run dev
   ```
   The server will start on port **4000**.

2. Open your browser and navigate to:
   http://localhost:4000

## Remote Access (Optional)

If you need to access the application from a different device or share a preview URL, you can use `localtunnel`.

1. **Start the tunnel**:
   ```bash
   npx localtunnel --port 4000
   ```
2. **Access the URL**:
   Open the URL provided by the command (e.g., `https://fair-badgers-occur.loca.lt`).
3. **Enter the Password**:
   Localtunnel requires a password (your public IP) to access the page. You can retrieve it by running:
   ```bash
   curl https://loca.lt/mytunnelpassword
   ```
   Copy the output IP address and paste it into the tunnel page.

## Usage Guide

1. **Upload**: 
   - Operations: Click "Choose File" and select an MP4 video.
   - Click "Upload".
   - **Note**: The transcoding process starts immediately. For larger files, this may take some time.

2. **Playback**:
   - Once the transcoding is sufficiently advanced, the player will appear.
   - Click the Play button to start streaming.

## Project Structure

- **index.js**: Main application entry point. Handles Express server, API routes, and transcoding logic.
- **videos/temp/**: Temporary storage for raw uploaded files.
- **public/videos/**: Storage for processed HLS streams (segments and playlists).
- **public/**: Static files (the HTML frontend).

## Technical Details

- **Express**: Web server framework.
- **Multer**: Middleware for handling `multipart/form-data` (file uploads).
- **Fluent-FFmpeg**: Abstraction layer for FFmpeg commands.
- **FFmpeg-static**: Provides static FFmpeg binaries.
- **HLS.js**: JavaScript library for playing HLS in browsers that don't support it natively.
