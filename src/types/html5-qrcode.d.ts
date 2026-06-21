declare module 'html5-qrcode' {
  export interface CameraDevice {
    id: string;
    label: string;
  }

  export class Html5Qrcode {
    constructor(elementId: string);
    isScanning: boolean;
    static getCameras(): Promise<CameraDevice[]>;
    start(
      cameraIdOrConfig: string | { facingMode: string },
      config: { fps: number; qrbox: { width: number; height: number } },
      onSuccess: (decodedText: string) => void,
      onError: (errorMessage: string) => void,
    ): Promise<void>;
    stop(): Promise<void>;
    clear(): void;
  }
}
