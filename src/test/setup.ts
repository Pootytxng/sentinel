import "@testing-library/jest-dom";

// jsdom doesn't implement scrollIntoView; stub it so components that reveal/scroll don't throw in tests.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}
