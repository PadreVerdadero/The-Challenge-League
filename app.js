<!-- index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>The Challenge League</title>
  <!-- Use relative path for stylesheet to work on GitHub Pages project site -->
  <link rel="stylesheet" href="styles.css">
  <!-- Canvas-Confetti for celebratory animations -->
  <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js" defer></script>
  <!-- Firebase SDKs (assume config is correct and included in app.js) -->
  <!-- Defer app.js to ensure DOM is parsed before script runs -->
  <script src="app.js" defer></script>
</head>
<body>
  <header>
    <h1>The Challenge League</h1>
    <div id="timer-container" aria-live="polite">
      <span id="timer-label">Next Challenge Reset In:</span>
      <span id="timer"></span>
    </div>
  </header>
  <main>
    <section id="champion-section">
      <h2>Champion</h2>
      <div id="champion" class="pill champion" tabindex="0" aria-label="Current Champion"></div>
    </section>
    <section id="challenger-section">
      <h2>Challenger Queue</h2>
      <ul id="challenger-queue" aria-label="Challenger Queue"></ul>
    </section>
    <section id="match-history-section">
      <h2>Match History</h2>
      <ul id="match-history" aria-label="Match History"></ul>
    </section>
  </main>
  <!-- Canvas overlay for confetti/explosion -->
  <canvas id="celebration-canvas"></canvas>
  <footer>
    <p>Powered by Firebase &amp; GitHub Pages</p>
  </footer>
</body>
</html>
