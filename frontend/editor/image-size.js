// Size new images before committing them, so undo/save never capture a
// temporary landscape box. Existing images and component copies are untouched.
export async function imageSize(image) {
  let timer;
  try {
    await Promise.race([
      image.decode(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("图片读取超时，请重试")),
          15000,
        );
      }),
    ]);
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!(width > 0 && height > 0)) throw new Error("无法读取图片尺寸");
    const scale = Math.min(1, 480 / width, 320 / height);
    return {
      width: `${width * scale}px`,
      height: `${height * scale}px`,
      objectFit: "contain",
    };
  } finally {
    clearTimeout(timer);
  }
}
