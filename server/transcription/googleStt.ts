import { storage } from "../storage";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

export async function transcribeWithGoogle(
  audioBuffer: Buffer,
  inputMimeType: string = "audio/webm",
  languageCode: string = "en-US"
): Promise<string> {
  const credentials = await storage.getSetting("google_stt_credentials");
  if (!credentials) {
    throw new Error("Google STT not configured. Add credentials in Admin > Settings.");
  }

  let credentialsJson: any;
  try {
    credentialsJson = JSON.parse(credentials);
  } catch {
    throw new Error("Invalid Google STT credentials format.");
  }

  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `stt-input-${Date.now()}.webm`);
  const outputPath = path.join(tmpDir, `stt-output-${Date.now()}.wav`);
  const credPath = path.join(tmpDir, `stt-creds-${Date.now()}.json`);

  try {
    fs.writeFileSync(inputPath, audioBuffer);
    fs.writeFileSync(credPath, JSON.stringify(credentialsJson));

    await execFileAsync("ffmpeg", [
      "-i", inputPath,
      "-ar", "16000",
      "-ac", "1",
      "-f", "wav",
      "-acodec", "pcm_s16le",
      "-y",
      outputPath,
    ], { timeout: 30000 });

    const wavBuffer = fs.readFileSync(outputPath);
    const audioContent = wavBuffer.toString("base64");

    const { SpeechClient } = await import("@google-cloud/speech");
    const client = new SpeechClient({
      credentials: credentialsJson,
    });

    const [response] = await client.recognize({
      audio: { content: audioContent },
      config: {
        encoding: "LINEAR16" as any,
        sampleRateHertz: 16000,
        languageCode: languageCode,
        enableAutomaticPunctuation: true,
        model: "latest_long",
      },
    });

    const transcript = response.results
      ?.map((result: any) => result.alternatives?.[0]?.transcript || "")
      .join(" ")
      .trim();

    return transcript || "";
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
    try { fs.unlinkSync(credPath); } catch {}
  }
}
