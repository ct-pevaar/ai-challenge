document.getElementById("read").addEventListener("click", async () => {
  const url = document.getElementById("url").value.trim();
  const status = document.getElementById("status");

  if (!url) {
    alert("Ingresa una URL válida");
    return;
  }

  status.textContent = "Procesando con Azure AI...";

  try {
    const resp = await fetch(`http://localhost:7071/api/read?url=${encodeURIComponent(url)}`);
    if (!resp.ok) throw new Error("Error en la función");
    
    const data = await resp.json();
    const audioSrc = `data:audio/mp3;base64,${data.audio}`;
    status.innerHTML = `
      <h2>Resumen completo</h2>
      <p>${data.summary}</p>
      <h3>Texto visible (recortado por límite de tokens)</h3>
      <p>${data.text.slice(0, 1000)}...</p>
      <audio controls src="${audioSrc}"></audio>
    `;
    console.log(data);
  } catch (err) {
    console.error(err);
    status.textContent = "Error: " + err.message;
  }
});
