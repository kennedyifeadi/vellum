import fs from 'fs';

async function upload() {
  const fileBuffer = fs.readFileSync('test.mp4');
  const blob = new Blob([fileBuffer], { type: 'video/mp4' });
  const formData = new FormData();
  formData.append('video', blob, 'test.mp4');
  formData.append('quality', 'Medium');
  formData.append('resolution', 'Original');

  try {
    const res = await fetch('http://localhost:3000/api/convert/video-compress', {
        method: 'POST',
        body: formData
    });
    
    if (!res.ok) {
        const err = await res.json();
        console.error('Server error response:', err);
    } else {
        const buffer = await res.arrayBuffer();
        console.log('Success, received bytes:', buffer.byteLength);
    }
  } catch(e) {
    console.error('Fetch error:', e);
  }
}

upload();
