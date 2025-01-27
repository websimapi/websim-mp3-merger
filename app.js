class MP3Merger {
  constructor() {
    this.files = [];
    this.setupEventListeners();
  }

  setupEventListeners() {
    document.getElementById('audioFiles').addEventListener('change', (e) => this.handleFileSelect(e));
    document.getElementById('mergeButton').addEventListener('click', () => this.mergeFiles());
  }

  handleFileSelect(event) {
    const newFiles = Array.from(event.target.files);
    
    // Only accept MP3 files
    const mp3Files = newFiles.filter(file => file.type === 'audio/mpeg');
    
    this.files.push(...mp3Files);
    this.updateFileList();
    this.updateMergeButton();
  }

  updateFileList() {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';

    this.files.forEach((file, index) => {
      const fileItem = document.createElement('div');
      fileItem.className = 'file-item';
      fileItem.innerHTML = `
        <span>${file.name}</span>
        <button onclick="mp3Merger.removeFile(${index})">Remove</button>
      `;
      fileList.appendChild(fileItem);
    });
  }

  removeFile(index) {
    this.files.splice(index, 1);
    this.updateFileList();
    this.updateMergeButton();
  }

  updateMergeButton() {
    const mergeButton = document.getElementById('mergeButton');
    mergeButton.disabled = this.files.length < 2;
  }

  async mergeFiles() {
    const progressBar = document.getElementById('progress');
    const progressFill = progressBar.querySelector('.progress-fill');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const statusText = document.getElementById('statusText');
    
    try {
      loadingOverlay.style.display = 'flex';
      progressBar.style.display = 'block';
      
      statusText.textContent = 'Reading files...';
      // Process files in chunks to prevent memory issues
      const CHUNK_SIZE = 5;
      let processedFiles = 0;
      let audioBuffers = [];
      
      for (let i = 0; i < this.files.length; i += CHUNK_SIZE) {
        const chunk = this.files.slice(i, i + CHUNK_SIZE);
        const chunkBuffers = await Promise.all(
          chunk.map(file => this.readFileAsArrayBuffer(file))
        );
        audioBuffers.push(...chunkBuffers);
        processedFiles += chunk.length;
        
        // Update progress
        const readProgress = processedFiles / this.files.length;
        progressFill.style.width = `${readProgress * 50}%`; // First 50% for reading
        
        // Allow UI to update
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      statusText.textContent = 'Processing audio...';
      // Merge the audio data
      const mergedBlob = await this.mergeAudioBuffers(audioBuffers, (progress) => {
        // Second 50% for processing
        progressFill.style.width = `${50 + (progress * 50)}%`;
      });

      statusText.textContent = 'Preparing download...';
      // Create download link
      const url = URL.createObjectURL(mergedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'merged.mp3';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      loadingOverlay.style.display = 'none';
      progressBar.style.display = 'none';
      progressFill.style.width = '0%';
    } catch (error) {
      console.error('Error merging files:', error);
      alert('Error merging files. Please try again.');
      loadingOverlay.style.display = 'none';
      progressBar.style.display = 'none';
      progressFill.style.width = '0%';
    }
  }

  async mergeAudioBuffers(audioBuffers, progressCallback) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Decode audio data in chunks
    const DECODE_CHUNK_SIZE = 3;
    let decodedBuffers = [];
    
    for (let i = 0; i < audioBuffers.length; i += DECODE_CHUNK_SIZE) {
      const chunk = audioBuffers.slice(i, i + DECODE_CHUNK_SIZE);
      const decodedChunk = await Promise.all(
        chunk.map(buffer => audioContext.decodeAudioData(buffer))
      );
      decodedBuffers.push(...decodedChunk);
      
      // Allow UI to update
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Calculate total length
    const totalLength = decodedBuffers.reduce((acc, buffer) => acc + buffer.length, 0);
    
    // Create merged buffer
    const mergedBuffer = audioContext.createBuffer(
      decodedBuffers[0].numberOfChannels,
      totalLength,
      decodedBuffers[0].sampleRate
    );

    let offset = 0;
    const MERGE_CHUNK_SIZE = 100000; // Process 100k samples at a time

    for (let i = 0; i < decodedBuffers.length; i++) {
      const buffer = decodedBuffers[i];
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const mergedChannelData = mergedBuffer.getChannelData(channel);
        const bufferChannelData = buffer.getChannelData(channel);
        
        // Copy data in chunks
        for (let j = 0; j < bufferChannelData.length; j += MERGE_CHUNK_SIZE) {
          const chunk = bufferChannelData.subarray(
            j,
            Math.min(j + MERGE_CHUNK_SIZE, bufferChannelData.length)
          );
          mergedChannelData.set(chunk, offset + j);
          
          // Allow UI to update every few chunks
          if (j % (MERGE_CHUNK_SIZE * 5) === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      }
      offset += buffer.length;
      progressCallback((i + 1) / decodedBuffers.length);
    }

    // Convert to MP3 with chunked processing
    return await this.convertToMP3Chunked(mergedBuffer);
  }

  async convertToMP3Chunked(audioBuffer) {
    const mp3Encoder = new lamejs.Mp3Encoder(
      audioBuffer.numberOfChannels,
      audioBuffer.sampleRate,
      128
    );

    const channels = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      channels.push(audioBuffer.getChannelData(i));
    }

    const mp3Data = [];
    const sampleBlockSize = 1152;
    const CHUNKS_PER_ITERATION = 100;
    
    for (let i = 0; i < channels[0].length; i += sampleBlockSize * CHUNKS_PER_ITERATION) {
      const endIndex = Math.min(i + sampleBlockSize * CHUNKS_PER_ITERATION, channels[0].length);
      
      for (let j = i; j < endIndex; j += sampleBlockSize) {
        const left = channels[0].slice(j, j + sampleBlockSize);
        const right = channels[1] ? channels[1].slice(j, j + sampleBlockSize) : left;
        
        const leftInt16 = new Int16Array(left.map(n => n * 0x7FFF));
        const rightInt16 = new Int16Array(right.map(n => n * 0x7FFF));
        
        const mp3buf = mp3Encoder.encodeBuffer(leftInt16, rightInt16);
        if (mp3buf.length > 0) {
          mp3Data.push(mp3buf);
        }
      }
      
      // Allow UI to update periodically
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const end = mp3Encoder.flush();
    if (end.length > 0) {
      mp3Data.push(end);
    }

    return new Blob([new Uint8Array(mp3Data.reduce((acc, cur) => [...acc, ...cur], []))], { type: 'audio/mpeg' });
  }

  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
}

const mp3Merger = new MP3Merger();