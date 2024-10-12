import {
    Rows,
    Text,
    FileInput,
    SegmentedControl,
    Button,
    ProgressBar,
    Alert,
    FormField,
    FileInputItem,
    Title,
    Box,
    ReloadIcon,
    Badge,
    Slider,
} from "@canva/app-ui-kit";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
    ContentDraft,
    ImageRef,
    ImageElementAtPoint,
} from "@canva/design";
import { addElementAtPoint, selection } from "@canva/design";
import { useMutation } from "@tanstack/react-query";
import styles from "styles/components.css";
import type { ImageMimeType } from "@canva/asset";
import { getTemporaryUrl, upload } from "@canva/asset";
import ReactCompareImage from "react-compare-image";

enum Reflection {
    Below = "Below",
    Above = "Above",
    Left = "Left",
    Right = "Right",
}

const maxImageSize = 2500 * 2500 * 2;
async function fileToDataUrl(file: Blob) {
    return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(reader.result as string);
        };
        reader.readAsDataURL(file);
    });
}

async function getImagePixels(file: Blob) {
    return new Promise<{ pixels: number; width: number; height: number }>(
        (resolve) => {
            const img = new Image();
            img.onload = () => {
                resolve({
                    pixels: img.width * img.height,
                    width: img.width,
                    height: img.height,
                });
            };
            img.src = URL.createObjectURL(file);
        }
    );
}

async function readCanvaNativeImageURL(url: string): Promise<File> {
    const res = await fetch(url);
    const formatMatch = url.match(/format:([A-Z]+)/);
    const ext = formatMatch ? formatMatch[1].toLowerCase() : "png";
    return new File([await res.blob()], `selected-image.${ext}`, {
        type: `image/${ext}`,
    });
}

export const App = () => {
    const [[file], setFiles] = useState<File[]>([]);
    const [imageSourceType, setImageSourceType] = useState<
        "upload" | "content" | "unknown"
    >("unknown");
    const [contentDraft, setContentDraft] = useState<ContentDraft<{
        ref: ImageRef;
    }> | null>(null);

    const [reflectionFactor, setReflectionFactor] = useState(Reflection.Above);
    const [offsetFactor, setOffsetFactor] = useState(1);
    const [opacityFactor, setOpacityFactor] = useState(1);
    const [originImageURL, setOriginImageURL] = useState("");
    const [imagePixels, setImagePixels] = useState(0);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [hasSelect, setHasSelect] = useState(false);

    const {
        data: enlargedData,
        mutateAsync,
        isPending: uploading,
        error: processImageError,
        reset: resetProcessImage,
    } = useMutation({
        mutationFn: async ({
            file,
            reflectionFactor,
        }: {
            file: File;
            reflectionFactor: Reflection;
        }) => {
            const body = new FormData();
            body.append("file", file);
            body.append("reflection_actor", reflectionFactor);

            setUploadProgress(0);

            const interval = setInterval(() => {
                setUploadProgress((prev) => {
                    if (prev === 75) {
                        clearInterval(interval);
                        return prev;
                    }
                    return Math.min(prev + 1, 75);
                });
            }, 200);

            try {
                const res = await fetch(`${BACKEND_HOST}/enlarge`, {
                    method: "POST",
                    body,
                });

                setUploadProgress(100);

                if (res.status !== 200) {
                    if (res.status === 500) {
                        throw new Error("Server error, please try again");
                    }
                    if (res.status === 504 || res.status === 524) {
                        throw new Error("Request timeout, please try again");
                    }

                    if (res.status === 413) {
                        throw new Error(
                            "Image too large, please replace with a smaller image"
                        );
                    }
                    throw new Error(
                        "Failed to process image:" + res.statusText
                    );
                }
                const file2 = new File([await res.blob()], file.name, {
                    type: "image/png",
                });
                return { url: await fileToDataUrl(file2), file: file2 };
            } catch (e) {
                if (e instanceof Error && e.message === "Failed to fetch") {
                    throw new Error(
                        "Failed to connect to server, please try again"
                    );
                }
            }
        },
    });

    const enlargedUrl = enlargedData?.url;

    const stateRef = useRef({ imageSourceType, uploading, enlargedUrl });

    stateRef.current = {
        imageSourceType,
        uploading,
        enlargedUrl,
    };

    useEffect(() => {
        return selection.registerOnChange({
            scope: "image",
            async onChange(event) {
                const draft = await event.read();
                const ref = draft.contents[0]?.ref;
                setHasSelect(!!ref);
                const { imageSourceType, enlargedUrl, uploading } =
                    stateRef.current;
                if (imageSourceType === "upload" || enlargedUrl || uploading) {
                    return;
                }

                setContentDraft(draft);
                if (ref) {
                    setImageSourceType("content");
                    const { url } = await getTemporaryUrl({
                        type: "image",
                        ref,
                    });

                    const file = await readCanvaNativeImageURL(url);
                    setFiles([file]);
                } else if (imageSourceType === "content" && !uploading) {
                    resetData();
                }
            },
        });
    }, []);

    useEffect(() => {
        if (!file || !FileReader) {
            return;
        }

        fileToDataUrl(file).then(setOriginImageURL);
        getImagePixels(file).then(({ pixels }) => setImagePixels(pixels));
    }, [file]);

    const {
        mutate: acceptImage,
        reset: resetAcceptImage,
        data: acceptResult,
        error,
    } = useMutation({
        mutationKey: [],
        mutationFn: async ({
            enlargedUrl,
            file,
            hasSelect,
        }: {
            enlargedUrl: string;
            file: File;
            hasSelect: boolean;
        }) => {
            if (
                contentDraft?.contents.length &&
                imageSourceType === "content" &&
                hasSelect
            ) {
                const asset = await upload({
                    type: "image",
                    url: enlargedUrl,
                    thumbnailUrl: enlargedUrl,
                    mimeType: "image/png" as ImageMimeType,
                    parentRef: contentDraft.contents[0].ref,
                    aiDisclosure: "app_generated",
                });

                contentDraft.contents[0].ref = asset.ref;
                await contentDraft.save();
                return "replaced";
            } else {
                await addElementAtPoint({
                    type: "image",
                    dataUrl: enlargedUrl,
                } as ImageElementAtPoint);
                return "added";
            }
        },
    });

    const enlargeFactorOptions = useMemo(() => {
        return [
            {
                value: "2",
                label: "2X",
                disabled: imagePixels * 2 > maxImageSize,
            },
            {
                value: "3",
                label: "3X",
                disabled: imagePixels * 3 > maxImageSize,
            },
            {
                value: "4",
                label: "4X",
                disabled: imagePixels * 4 > maxImageSize,
            },
            {
                value: "8",
                label: "8X",
                disabled: imagePixels * 8 > maxImageSize,
            },
        ];
    }, [originImageURL, imagePixels]);

    const resetData = () => {
        setFiles([]);
        setReflectionFactor(Reflection.Above);
        setOffsetFactor(1);
        setOpacityFactor(1);
        setOriginImageURL("");
        resetProcessImage();
        setImageSourceType("unknown");
        resetAcceptImage();
    };

    const isPixelExceeded = enlargeFactorOptions.every(
        (option) => option.disabled
    );

    const isFileExceeded = file?.size > 1024 * 1024 * 5;

    const CvsRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const cvs = CvsRef.current;

        if (!cvs) return;

        const ctx = cvs.getContext("2d");

        if (!ctx) return;

        const img = new Image();
        img.src = originImageURL;

        img.onload = () => {
            const dpr = window.devicePixelRatio || 1;

            const cssWidth = cvs.clientWidth;
            const cssHeight = cvs.clientHeight;

            cvs.width = cssWidth * dpr;
            cvs.height = cssHeight * dpr;

            ctx.scale(dpr, dpr);

            const { width: imgWidth, height: imgHeight } = img;

            const imgAspectRatio = imgWidth / imgHeight;
            const canvasAspectRatio = cssWidth / cssHeight;

            const [drawWidth, drawHeight] =
                imgAspectRatio > canvasAspectRatio
                    ? [cssWidth, cssWidth / imgAspectRatio]
                    : [cssHeight * imgAspectRatio, cssHeight];

            const [offsetX, offsetY] =
                imgAspectRatio > canvasAspectRatio
                    ? [0, (cssHeight - drawHeight) / 2]
                    : [(cssWidth - drawWidth) / 2, 0];

            ctx.clearRect(0, 0, cssWidth, cssHeight);

            ctx.globalAlpha = opacityFactor;

            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

            let gradient: CanvasGradient;
            switch (reflectionFactor) {
                case Reflection.Above:
                    gradient = ctx.createLinearGradient(0, 0, 0, cssHeight);
                    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
                    gradient.addColorStop(
                        offsetFactor,
                        "rgba(255, 255, 255, 0)"
                    );
                    break;

                case Reflection.Below:
                    gradient = ctx.createLinearGradient(0, cssHeight, 0, 0);
                    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
                    gradient.addColorStop(
                        offsetFactor,
                        "rgba(255, 255, 255, 0)"
                    );
                    break;

                case Reflection.Left:
                    gradient = ctx.createLinearGradient(0, 0, cssWidth, 0);
                    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
                    gradient.addColorStop(
                        offsetFactor,
                        "rgba(255, 255, 255, 0)"
                    );
                    break;

                case Reflection.Right:
                    gradient = ctx.createLinearGradient(cssWidth, 0, 0, 0);
                    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
                    gradient.addColorStop(
                        offsetFactor,
                        "rgba(255, 255, 255, 0)"
                    );
                    break;

                default:
                    return;
            }

            ctx.globalCompositeOperation = "destination-in";
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, cssWidth, cssHeight);

            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = 1;

            const outputCanvas = document.createElement("canvas");
            const outputCtx = outputCanvas.getContext("2d");

            outputCanvas.width = imgWidth;
            outputCanvas.height = imgHeight;

            if (!outputCtx) return;

            outputCtx.drawImage(img, 0, 0, imgWidth, imgHeight);

            outputCanvas.toBlob((blob) => {
                if (!blob) return;

                const file = new File([blob], "processed-image.png", {
                    type: "image/png",
                });

                setFiles([file]);
            }, "image/png");
        };

        img.onerror = () => {
            // error
        };
    }, [reflectionFactor, originImageURL, offsetFactor, opacityFactor]);

    const reflectionOptions = useMemo(() => {
        return [
            {
                value: Reflection.Below,
                label: Reflection.Below,
            },
            {
                value: Reflection.Above,
                label: Reflection.Above,
            },
            {
                value: Reflection.Left,
                label: Reflection.Left,
            },
            {
                value: Reflection.Right,
                label: Reflection.Right,
            },
        ];
    }, [originImageURL, imagePixels]);

    if (uploading) {
        return (
            <Box
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                display="flex"
                className={styles.scrollContainer}
                paddingEnd="2u"
            >
                <Rows spacing="2u">
                    <Title size="small" alignment="center">
                        Generating your image
                    </Title>
                    <ProgressBar value={uploadProgress} />
                    <Text alignment="center" size="small" tone="tertiary">
                        Please wait, this should only take a few moments
                    </Text>
                    <Button onClick={resetData} variant="secondary">
                        Cancel
                    </Button>
                </Rows>
            </Box>
        );
    }

    return (
        <div className={styles.scrollContainer}>
            {enlargedUrl ? (
                <Rows spacing="2u">
                    <>
                        <Rows spacing="1u">
                            {!!acceptResult && (
                                <Alert
                                    tone="positive"
                                    onDismiss={resetAcceptImage}
                                >
                                    <Text variant="bold">
                                        {acceptResult === "added"
                                            ? "Image added to design"
                                            : "Image replaced"}
                                    </Text>
                                </Alert>
                            )}

                            <Text variant="bold" size="medium">
                                Preview
                            </Text>

                            <div className={styles.imageCompareContainer}>
                                <ReactCompareImage
                                    sliderLineColor=""
                                    leftImage={originImageURL}
                                    rightImage={enlargedUrl}
                                    leftImageLabel={
                                        <Badge tone="contrast" text="Before" />
                                    }
                                    rightImageLabel={
                                        <Badge tone="contrast" text="After" />
                                    }
                                />
                            </div>
                        </Rows>

                        <Rows spacing="1u">
                            <Button
                                variant="primary"
                                onClick={() =>
                                    acceptImage({
                                        enlargedUrl,
                                        file,
                                        hasSelect,
                                    })
                                }
                            >
                                {imageSourceType === "upload" || !hasSelect
                                    ? "Add to design"
                                    : "Replace"}
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={resetData}
                                icon={ReloadIcon}
                            >
                                Go back
                            </Button>
                        </Rows>
                    </>
                </Rows>
            ) : (
                <Rows spacing="2u">
                    <>
                        <FormField
                            description={
                                originImageURL
                                    ? ""
                                    : "Upload an image or select one in your design to enlarge"
                            }
                            label="Original image"
                            control={(props) =>
                                originImageURL ? (
                                    <>
                                        <canvas
                                            ref={CvsRef}
                                            className={styles["cvs-preview"]}
                                        />

                                        {imageSourceType === "upload" && (
                                            <FileInputItem
                                                onDeleteClick={() => {
                                                    resetData();
                                                }}
                                                label={file?.name}
                                            />
                                        )}
                                    </>
                                ) : (
                                    <FileInput
                                        {...props}
                                        accept={[
                                            "image/png",
                                            "image/jpeg",
                                            "image/jpg",
                                            "image/webp",
                                        ]}
                                        stretchButton
                                        onDropAcceptedFiles={(files) => {
                                            setImageSourceType("upload");
                                            setFiles(files);
                                        }}
                                    />
                                )
                            }
                        />

                        {!!file && (
                            <FormField
                                error={
                                    (isPixelExceeded || isFileExceeded) &&
                                    "This File is too large.Please choose one that's smaller than 2500px x 2500px or 5MB."
                                }
                                label="Position"
                                control={(props) => (
                                    <SegmentedControl
                                        {...props}
                                        defaultValue={Reflection.Above}
                                        value={reflectionFactor}
                                        onChange={setReflectionFactor}
                                        options={reflectionOptions}
                                    />
                                )}
                            />
                        )}

                        {!!file && (
                            <FormField
                                error={
                                    (isPixelExceeded || isFileExceeded) &&
                                    "This File is too large.Please choose one that's smaller than 2500px x 2500px or 5MB."
                                }
                                label="Opacity"
                                control={(props) => (
                                    <Slider
                                        {...props}
                                        min={0}
                                        max={1}
                                        step={0.1}
                                        value={opacityFactor}
                                        onChange={setOpacityFactor}
                                    />
                                )}
                            />
                        )}

                        {!!file && (
                            <FormField
                                error={
                                    (isPixelExceeded || isFileExceeded) &&
                                    "This File is too large.Please choose one that's smaller than 2500px x 2500px or 5MB."
                                }
                                label="Offset"
                                control={(props) => (
                                    <Slider
                                        {...props}
                                        min={0}
                                        max={1}
                                        step={0.1}
                                        value={offsetFactor}
                                        onChange={setOffsetFactor}
                                    />
                                )}
                            />
                        )}

                        {!!file && (
                            <Button
                                stretch
                                variant="primary"
                                type="submit"
                                disabled={!file}
                                onClick={() =>
                                    mutateAsync({ file, reflectionFactor })
                                }
                            >
                                Generate
                            </Button>
                        )}
                        {processImageError && (
                            <Alert tone="critical">
                                {processImageError.message}
                            </Alert>
                        )}
                    </>
                </Rows>
            )}
        </div>
    );
};
