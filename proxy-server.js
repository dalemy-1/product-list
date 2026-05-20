const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;  // 选择一个端口

app.get('/api/products', async (req, res) => {
  try {
    const response = await axios.get('http://154.48.226.28:801/8ce7d1f0-8aa0-4da7-afe2-84653fbe52ea');
    res.send(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching product data');
  }
});

app.listen(port, () => {
  console.log(`Proxy server running at http://localhost:${port}`);
});
