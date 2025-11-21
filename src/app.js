document.getElementById("read").addEventListener("click", async () => {
  const url = document.getElementById("url").value.trim();
  const status = document.getElementById("status");

  if (!url) {
    alert("Ingresa una URL válida");
    return;
  }

  status.textContent = "Procesando con Azure AI...";

  try {
    const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
      ? 'http://localhost:7071' 
      : window.location.origin;
    
    console.log('Enviando URL:', url);
    console.log('A endpoint:', `${baseUrl}/api/read`);
    console.log('Body:', JSON.stringify({ url: url }));
    
    const resp = await fetch(`${baseUrl}/api/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: url })
    });
    
    const data = await resp.json();
    console.log('Respuesta completa:', data);
    
    if (!resp.ok || !data.success) {
      throw new Error(data.error || "Error en la función");
    }
    const audioSrc = `data:audio/mp3;base64,${data.audio}`;
    status.innerHTML = `
      <h2>Resumen completo</h2>
      <p>${data.summary}</p>
      <h3>Texto visible (recortado por límite de tokens)</h3>
      <p>${data.text.slice(0, 1000)}...</p>
      <audio controls src="${audioSrc}" id="audioPlayer"></audio>
    `;
    
    const audioPlayer = document.getElementById("audioPlayer");
    audioPlayer.play().catch(err => {
      console.log("No se pudo reproducir automáticamente:", err);
    });
    
    console.log(data);
  } catch (err) {
    console.error(err);
    status.textContent = "Error: " + err.message;
  }
});
