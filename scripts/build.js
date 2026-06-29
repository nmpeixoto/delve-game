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

// Inline generated pixed assets for single-file production.
const pixedManifestPath = path.join(srcDir, 'assets', 'pixed', 'pixed_manifest.json');
if (fs.existsSync(pixedManifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(pixedManifestPath, 'utf8'));
    const inlineAssets = {};
    Object.values(manifest).forEach(meta => {
        if (!inlineAssets[meta.src]) {
            const assetPath = path.join(srcDir, 'assets', 'pixed', meta.src);
            const data = fs.readFileSync(assetPath);
            inlineAssets[meta.src] = `data:image/png;base64,${data.toString('base64')}`;
        }
    });
    const assetScript = `<script>\nwindow.PIXED_INLINE_MANIFEST=${JSON.stringify(manifest)};\nwindow.PIXED_INLINE_ASSETS=${JSON.stringify(inlineAssets)};\n</script>`;
    html = html.replace('</head>', `${assetScript}\n</head>`);
}

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
