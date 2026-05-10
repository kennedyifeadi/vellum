export async function resolveFiles(formData: FormData, fieldName: string): Promise<File[]> {
  const localFiles = formData.getAll(fieldName) as File[];
  const googleDriveFilesStr = formData.getAll('googleDriveFiles') as string[];
  
  const files: File[] = [...localFiles];
  
  for (const gStr of googleDriveFilesStr) {
    try {
      const gData = JSON.parse(gStr);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${gData.id}?alt=media`, {
        headers: { Authorization: `Bearer ${gData.accessToken}` }
      });
      
      if (!res.ok) throw new Error(`Google Drive API returned ${res.status}`);
      
      const arrayBuffer = await res.arrayBuffer();
      
      // Node 20+ has native File support, but if not we can polyfill its basic shape
      try {
        const file = new File([arrayBuffer], gData.name, { type: res.headers.get('Content-Type') || 'application/octet-stream' });
        files.push(file);
      } catch (e) {
        // Fallback if File is not available in the Node environment
        const fakeFile = {
          name: gData.name,
          type: res.headers.get('Content-Type') || 'application/octet-stream',
          size: arrayBuffer.byteLength,
          arrayBuffer: async () => arrayBuffer,
          stream: () => { throw new Error('Not implemented'); },
          slice: () => { throw new Error('Not implemented'); },
          text: async () => new TextDecoder().decode(arrayBuffer)
        } as unknown as File;
        files.push(fakeFile);
      }
    } catch (err) {
      console.error('Failed to resolve Google Drive file:', err);
      throw new Error('Failed to download file from Google Drive');
    }
  }
  
  return files;
}
