/** Triggers a browser "Save As" download of `blob` named `name`. */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // give the browser a tick to start the download before revoking
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
