export default class BrowserWorker {
  constructor() {
    throw new Error("Web Workers are unavailable in the Node UI test environment.");
  }
}
