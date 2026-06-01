const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const srcDir = path.join(repoRoot, 'src');
const indexHtmlPath = path.join(srcDir, 'index.html');
const outHtmlPath = path.join(repoRoot, 'dungeon.html');

let html = fs.readFileSync(indexHtmlPath, 'utf8');

// Inline CSS
html = html.replace(/<link rel="stylesheet" href="css\/style\.css">/, () => {
    const css = fs.readFileSync(path.join(srcDir, 'css', 'style.css'), 'utf8');
    return `<style>\n${css}\n</style>`;
});

// Inline JS
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (match, jsPath) => {
    const js = fs.readFileSync(path.join(srcDir, jsPath), 'utf8');
    return `<script>\n${js}\n</script>`;
});

// Fix asset paths for single-level root deployment
html = html.replace(/href="\.\.\//g, 'href="');
html = html.replace(/src="\.\.\//g, 'src="');
html = html.replace(/navigator\.serviceWorker\.register\('\.\.\/sw\.js'\)/g, "navigator.serviceWorker.register('sw.js')");

fs.writeFileSync(outHtmlPath, html);
console.log('Successfully built dungeon.html');
