import { app } from '@azure/functions';
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_KEY;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
const speechKey = process.env.AZURE_SPEECH_KEY;
const speechRegion = process.env.AZURE_SPEECH_REGION;

app.http('read', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // Manejar preflight CORS request
    if (request.method === 'OPTIONS') {
      return {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      };
    }

    try {
      const body = await request.json();
      let url = body?.url;
      
      context.log('URL recibida:', url);
      
      if (!url || typeof url !== 'string') {
        return { 
          status: 400, 
          headers: { 
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
          },
          jsonBody: { error: "Se requiere una URL válida en el body" }
        };
      }

      // Limpiar la URL
      url = url.trim();
      
      // Asegurar que la URL tenga protocolo
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      
      context.log('URL procesada:', url);
      
      // Validar que la URL sea válida
      try {
        new URL(url);
      } catch (urlError) {
        context.error('URL inválida:', url, urlError.message);
        return { 
          status: 400, 
          headers: { 
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
          },
          jsonBody: { error: `URL inválida: ${url}` }
        };
      }

      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (!resp.ok) throw new Error(`Error al descargar: ${resp.status}`);
      const html = await resp.text();

      const $ = cheerio.load(html);
      let text = $("body").text();
      text = text.replace(/\s+/g, " ").trim();

      const chunk = text.slice(0, 7000);

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

      return { 
        status: 200,
        headers: { 
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        jsonBody: { success: true, summary, text: chunk, audio: audioBuffer.toString("base64") } 
      };
    } catch (err) {
      context.error("Error completo:", err);
      return { 
        status: 500, 
        headers: { 
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        jsonBody: { success: false, error: err.message } 
      };
    }
  }
});
