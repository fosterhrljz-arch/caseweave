import Tesseract from 'tesseract.js';
import workerScript from 'tesseract.js/dist/worker.min.js?raw';
import coreScript from 'tesseract.js-core/tesseract-core-lstm.wasm.js?raw';
import english from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?base64';
import chinese from '@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz?base64';

const modelBase = 'https://caseweave.invalid/ocr';

export async function recognize(canvas, language) {
  const packs = language === 'zh' ? { chi_sim: chinese, eng: english } : { eng: english };
  const models = Object.fromEntries(Object.entries(packs).map(([code, data]) => [`${modelBase}/${code}.traineddata.gz`, data]));
  // The worker serves its embedded models without a network request, including from file://.
  const modelLoader = `const bundledModels = ${JSON.stringify(models)};
    const nativeFetch = self.fetch.bind(self);
    self.fetch = async (url, options) => {
      const href = String(url);
      const packed = bundledModels[href];
      if (packed) return new Response(Uint8Array.from(atob(packed), character => character.charCodeAt(0)));
      if (href.startsWith('data:') || href.startsWith('blob:')) return nativeFetch(url, options);
      throw new Error('The requested OCR model is unavailable in this build.');
    };`;
  const workerUrl = URL.createObjectURL(new Blob([modelLoader, '\n', coreScript, '\n;\n', workerScript], { type: 'application/javascript' }));
  let worker;
  let timer;
  try {
    let fail;
    const failure = new Promise((_, reject) => {
      fail = message => reject(new Error(String(message || 'Could not initialize the OCR engine.')));
      timer = setTimeout(() => fail('The OCR engine took too long to start.'), 25_000);
    });
    worker = await Promise.race([Tesseract.createWorker(Object.keys(packs), 1, { workerPath: workerUrl, workerBlobURL: false, langPath: modelBase, cacheMethod: 'none', gzip: true, errorHandler: fail }), failure]);
    clearTimeout(timer);
    return (await worker.recognize(canvas)).data.text;
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
    URL.revokeObjectURL(workerUrl);
  }
}
