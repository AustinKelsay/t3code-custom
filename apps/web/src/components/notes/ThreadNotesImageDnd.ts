export const THREAD_NOTES_IMAGE_DRAG_MIME = "application/x-thread-notes-image-drag";
export const TRANSPARENT_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export const threadNotesImageDragGhost = (() => {
  const image = document.createElement("img");
  image.src = TRANSPARENT_IMAGE;
  return image;
})();
