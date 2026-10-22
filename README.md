# 🎨 Real-Time Collaborative Whiteboard

A high-performance, real-time collaborative whiteboard application built with React, Konva, and Yjs. This project demonstrates advanced state synchronization using Conflict-free Replicated Data Types (CRDTs) to allow multiple users to draw, move, and edit shapes simultaneously without merge conflicts.

## ✨ Features

* **Real-Time CRDT Synchronization:** Powered by Yjs, ensuring deterministic conflict resolution when multiple users edit the same objects.
* **Ephemeral Multiplayer Cursors:** Live mouse tracking with user identification using the Yjs Awareness protocol.
* **Infinite Canvas Viewport:** Pan and zoom across an infinite coordinate system.
* **Rich Toolset:** 
  * Select & Mass Selection (Bounding box).
  * Shapes: Rectangles, Circles, Triangles, and Stars.
  * Freehand drawing (Pencil tool).
* **Live Activity Log:** Real-time ledger of user actions. Hovering over a log entry displays details and highlights the specific shape on the canvas.
* **Customization:** 8-color palette for shape fills and pencil strokes.
* **Dark/Light Mode:** Seamless theme switching with a static dot-grid background.

## 🛠️ Tech Stack

* **Frontend Framework:** React (Vite)
* **Canvas Rendering:** Konva (`react-konva`)
* **State Synchronization:** Yjs (`yjs`)
* **Networking:** WebSockets (`y-websocket`)
* **Backend:** Node.js WebSocket Server

## 🚀 How to Run the Project

This project requires running two separate processes simultaneously: the **Backend WebSocket Server** (which syncs the drawing data) and the **Frontend React App** (the user interface).

### 🛠 Prerequisites

Make sure you have [Node.js](https://nodejs.org/) (version 16 or higher) installed on your computer.

### 📦 Step 1: Install Dependencies

Open your terminal, navigate to the root folder of your project, and run:

```bash
npm install
```

### 🖥 Step 2: Start the Backend Server

You need to start the WebSocket server first so the frontend has something to connect to. In your terminal, run:

```bash
node server.mjs
```

You should see a message in the terminal confirming the server is running. **Keep this terminal window open and running.**

### 🎨 Step 3: Start the Frontend App

Open a **new, separate terminal window** (do not close the backend one), navigate to your project folder again, and start the Vite development server:

```bash
npm run dev
```

Open your browser and navigate to the local URL provided (typically `http://localhost:5173`).

## 🤝 Testing Collaboration

1. Open your web browser and go to `http://localhost:5173`.
2. Open a **New Incognito Window** and go to the same address.
3. Put the windows side-by-side to watch shapes, cursors, and activity logs sync in real time!

## 🛑 Stopping the Servers

When you are done, go to each of your terminal windows and press `Ctrl + C` (or `Cmd + C` on Mac) to stop the servers.