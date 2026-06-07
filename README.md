# Pramithas Upreti — 3D Portfolio

A personal portfolio website built with HTML, CSS, JavaScript, Vite, and Three.js. The site presents my projects, background, and resume through an interactive 3D planetary interface designed for GitHub Pages deployment.

## Live Site

https://pramithas.com

## Repository

https://github.com/pralfredo/pramithas

## Overview

This portfolio was developed as a creative web project combining traditional front-end development with real-time 3D graphics. Instead of a standard static homepage, the site uses a cosmic scene with a central animated planet, orbiting navigation moons, glowing stars, and layered visual effects.

The goal was to create a portfolio that feels memorable while still functioning as a professional personal website.

## Features

* Interactive Three.js scene
* 3D planet centerpiece with lighting, rings, and atmospheric effects
* Orbiting spherical moons used as navigation elements
* Animated starfield with depth and twinkling motion
* Glassmorphism-inspired interface styling
* Resume link integration
* Responsive layout for desktop and browser viewing
* GitHub Pages deployment through Vite

## Tech Stack

* HTML
* CSS
* JavaScript
* Three.js
* Vite
* GitHub Pages

## Project Structure

```text
.
├── .github/workflows/     # Deployment workflow
├── public/                # Static assets
├── index.html             # Main HTML entry point
├── main.js                # Three.js scene and interactivity
├── styles.css             # Site styling
├── package.json           # Project dependencies and scripts
├── package-lock.json      # Dependency lock file
└── vite.config.js         # Vite configuration
```

## Running Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Deployment Notes

This site is intended to be hosted with GitHub Pages. Since the project uses Vite, the deployed version should use the production build output rather than raw source files.

For a project-page deployment, make sure `vite.config.js` uses the correct base path:

```js
export default {
  base: "/pramithas/"
}
```

## Author

**Pramithas Upreti**
GitHub: [@pralfredo](https://github.com/pralfredo)

## Acknowledgements

This project uses Three.js for browser-based 3D rendering and Vite for development/build tooling. AI assistance was used during development for debugging, code refinement, and design iteration.
