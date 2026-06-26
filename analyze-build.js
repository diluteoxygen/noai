const esbuild = require('esbuild');
const zlib = require('zlib');
const fs = require('fs');

async function analyze() {
  const entryPoints = {
    background: 'src/background/index.ts',
    content: 'src/content/index.ts',
    popup: 'src/popup/popup.ts',
    options: 'src/options/options.ts',
    blocked: 'src/blocked/blocked.ts'
  };

  for (const [name, entry] of Object.entries(entryPoints)) {
    console.log(`\n--- Analyzing ${name} ---`);
    
    // Minified build
    const resultMin = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: 'iife',
      write: false,
      metafile: true,
      platform: 'browser',
      target: ['firefox115']
    });

    // Unminified build
    const resultUnmin = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      minify: false,
      format: 'iife',
      write: false,
      metafile: true,
      platform: 'browser',
      target: ['firefox115']
    });

    const minOutput = resultMin.outputFiles[0].text;
    const minZipped = zlib.gzipSync(Buffer.from(minOutput)).length;

    console.log(`Total Unminified Size: ${resultUnmin.outputFiles[0].text.length} bytes`);
    console.log(`Total Minified Size: ${minOutput.length} bytes`);
    console.log(`Total Minified + Gzipped Size: ${minZipped} bytes`);

    // Analyze metafile to find webextension-polyfill contribution
    const analyzePolyfill = (meta) => {
      let polyfillSize = 0;
      for (const [outputFile, outputData] of Object.entries(meta.outputs)) {
        if (outputData.inputs) {
          for (const [inputFile, inputData] of Object.entries(outputData.inputs)) {
            if (inputFile.includes('webextension-polyfill')) {
              polyfillSize += inputData.bytesInOutput;
            }
          }
        }
      }
      return polyfillSize;
    };

    const polyfillSizeUnmin = analyzePolyfill(resultUnmin.metafile);
    const polyfillSizeMin = analyzePolyfill(resultMin.metafile);

    // Gzipped estimation (proportion of total)
    const polyfillSizeMinZipped = Math.round(minZipped * (polyfillSizeMin / minOutput.length));

    console.log(`Polyfill Unminified Contribution: ${polyfillSizeUnmin} bytes`);
    console.log(`Polyfill Minified Contribution: ${polyfillSizeMin} bytes`);
    console.log(`Polyfill Minified+Gzip Contribution (Estimated): ${polyfillSizeMinZipped} bytes`);
  }
}

analyze().catch(console.error);
