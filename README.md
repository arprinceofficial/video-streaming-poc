# Video Streaming POC

A YouTube-like video streaming Proof of Concept (POC) built with Node.js, Express, FFmpeg, and Prisma. Features include video upload, multi-quality HLS transcoding (360p to 4K), S3 storage integration, and a responsive UI.

## Features

- **Video Upload**: Drag-and-drop interface with progress tracking.
- **Transcoding**: Automatic transcoding to HLS format with multiple resolutions (360p, 480p, 720p, 1080p, 4K).
- **Adaptive Streaming**: HLS playback using `hls.js`.
- **Storage**:
  - Local filesystem storage.
  - Optional S3-compatible cloud storage support (e.g., AWS, Contabo).
- **Responsive UI**: Mobile-friendly video list and player.
- **Search & Pagination**: Server-side pagination and search functionality.

## Prerequisites

- **Node.js** (v18 or higher recommended)
- **PostgreSQL** (running locally or remotely)
- **FFmpeg** (installed via `ffmpeg-static` in the project, but having it on system is good practice)

## Installation

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd video-streaming-poc
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Database Config**:
    Ensure you have a PostgreSQL database running. Update the `DATABASE_URL` in your `.env` file (see Configuration).

4.  **Run Migrations**:
    Apply the database schema:
    ```bash
    npx prisma migrate dev
    ```

## Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/video_poc"

# S3 Storage (Optional)
# Set S3_CONNECTION to true to upload transcoded files to S3.
S3_CONNECTION=true
S3_BUCKET="your-bucket-name"
S3_REGION="usc1"
S3_ENDPOINT="https://usc1.contabostorage.com"
S3_ACCESS_KEY="your-access-key"
S3_SECRET_KEY="your-secret-key"
S3_USERNAME="your-s3-username" # Used for constructing the public URL
S3_BASE_FOLDER="hls-videos"     # Folder prefix in the bucket
```

## Running the Application

Start the development server:

```bash
npm run dev
```

The server will start on **port 4000**.
Access the application at: [http://localhost:4000](http://localhost:4000)

## Project Structure

- `index.js`: Main server file handling uploads, transcoding, and API routes.
- `prisma/schema.prisma`: Database schema definition.
- `public/`: Static frontend files (`index.html`, `videos.html`).
- `videos/temp/`: Temporary storage for uploaded raw video files (cleaned up after S3 upload).

## S3 Integration Guide

If `S3_CONNECTION=true` is set:
1.  Video is uploaded to the server first.
2.  FFmpeg transcodes the video to HLS format locally.
3.  The HLS contents are uploaded to the configured S3 bucket.
4.  Local temporary files are deleted to save space.
5.  The database records the S3 URL for playback.
