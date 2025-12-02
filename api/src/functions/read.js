import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(express.json());

const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_KEY;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
const speechKey = process.env.AZURE_SPEECH_KEY;
const speechRegion = process.env.AZURE_SPEECH_REGION;

app.get("/read", async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: "Falta el parámetro ?url=" });
  }

  try {
    // Descargar página
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Error al descargar: ${resp.status}`);

    const html = await resp.text();
    const $ = cheerio.load(html);

    let text = $("body").text().replace(/\s+/g, " ").trim();
    const chunk = text.slice(0, 7000);

    // Llamada a Azure OpenAI
    const aiResp = await fetch(
      `${endpoint}openai/deployments/${deployment}/chat/completions?api-version=2024-02-01`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "Eres un asistente experto en generar resúmenes claros y completos del contenido visible de una página web. no usas markdown" },
            { role: "user", content: `Por favor, haz un resumen comprensivo de este contenido:\n\n${chunk}` }
          ],
          max_tokens: 800,
          temperature: 0.5
        })
      }
    );

    const aiData = await aiResp.json();
    const summary = aiData.choices?.[0]?.message?.content || "No se pudo generar el resumen.";

    // TTS Speech Microsoft
    const ttsResp = await fetch(
      `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
          "Ocp-Apim-Subscription-Key": speechKey
        },
        body: `
        <speak version="1.0" xml:lang="es-ES">
          <voice xml:lang="es-MX" xml:gender="Male" name="es-MX-GerardoNeural">
            ${summary}
          </voice>
        </speak>`
      }
    );

    if (!ttsResp.ok) throw new Error("Error al generar audio con Speech");
    const audioBuffer = Buffer.from(await ttsResp.arrayBuffer());

    res.status(200).json({
      summary,
      text: chunk,
      audio: audioBuffer.toString("base64")
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
