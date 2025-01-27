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
    const overlayProgressFill = loadingOverlay.querySelector('.progress-fill');
    
    try {
      loadingOverlay.style.display = 'flex';
      progressBar.style.display = 'block';
      progressFill.style.width = '0%';
      overlayProgressFill.style.width = '0%';
      
      statusText.textContent = 'Reading files...';
      console.log('Starting file reading process...');
      
      // Process files in chunks to prevent memory issues
      const CHUNK_SIZE = 3; // Reduced chunk size for better stability
      let processedFiles = 0;
      let audioBuffers = [];
      
      for (let i = 0; i < this.files.length; i += CHUNK_SIZE) {
        const chunk = this.files.slice(i, i + CHUNK_SIZE);
        console.log(`Processing chunk ${i/CHUNK_SIZE + 1} of ${Math.ceil(this.files.length/CHUNK_SIZE)}`);
        
        const chunkBuffers = await Promise.all(
          chunk.map(async file => {
            try {
              const buffer = await this.readFileAsArrayBuffer(file);
              console.log(`Successfully read file: ${file.name}`);
              return buffer;
            } catch (error) {
              console.error(`Error reading file ${file.name}:`, error);
              throw new Error(`Failed to read file ${file.name}: ${error.message}`);
            }
          })
        );
        
        audioBuffers.push(...chunkBuffers);
        processedFiles += chunk.length;
        
        const readProgress = processedFiles / this.files.length;
        const progressPercent = readProgress * 33;
        progressFill.style.width = `${progressPercent}%`;
        overlayProgressFill.style.width = `${progressPercent}%`;
        
        await new Promise(resolve => setTimeout(resolve, 100)); // Increased delay for stability
      }

      statusText.textContent = 'Processing audio...';
      console.log('Starting audio processing...');
      
      const mergedBlob = await this.mergeAudioBuffers(audioBuffers, (progress) => {
        const progressPercent = 33 + (progress * 33);
        progressFill.style.width = `${progressPercent}%`;
        overlayProgressFill.style.width = `${progressPercent}%`;
      });

      statusText.textContent = 'Converting to MP3...';
      console.log('Starting MP3 conversion...');
      
      const finalMp3 = await this.convertToMP3Chunked(mergedBlob, (progress) => {
        const progressPercent = 66 + (progress * 34);
        progressFill.style.width = `${progressPercent}%`;
        overlayProgressFill.style.width = `${progressPercent}%`;
      });

      statusText.textContent = 'Preparing download...';
      console.log('Creating download link...');
      
      const url = URL.createObjectURL(finalMp3);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'merged.mp3';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('Process completed successfully');
      loadingOverlay.style.display = 'none';
      progressBar.style.display = 'none';
      progressFill.style.width = '0%';
      overlayProgressFill.style.width = '0%';
    } catch (error) {
      console.error('Detailed error in merging process:', error);
      statusText.textContent = `Error: ${error.message}`;
      await new Promise(resolve => setTimeout(resolve, 3000)); // Show error message for 3 seconds
      loadingOverlay.style.display = 'none';
      progressBar.style.display = 'none';
      progressFill.style.width = '0%';
      overlayProgressFill.style.width = '0%';
      alert(`Error merging files: ${error.message}\nPlease check console for details.`);
    }
  }

  async mergeAudioBuffers(audioBuffers, progressCallback) {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('Created AudioContext');
      
      // Decode audio data in smaller chunks
      const DECODE_CHUNK_SIZE = 2; // Reduced for stability
      let decodedBuffers = [];
      
      for (let i = 0; i < audioBuffers.length; i += DECODE_CHUNK_SIZE) {
        const chunk = audioBuffers.slice(i, i + DECODE_CHUNK_SIZE);
        console.log(`Decoding chunk ${i/DECODE_CHUNK_SIZE + 1} of ${Math.ceil(audioBuffers.length/DECODE_CHUNK_SIZE)}`);
        
        const decodedChunk = await Promise.all(
          chunk.map(async buffer => {
            try {
              return await audioContext.decodeAudioData(buffer.slice(0));
            } catch (error) {
              console.error('Error decoding audio data:', error);
              throw new Error('Failed to decode audio data. File might be corrupted.');
            }
          })
        );
        
        decodedBuffers.push(...decodedChunk);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log('All audio buffers decoded successfully');
      
      // Calculate total length
      const totalLength = decodedBuffers.reduce((acc, buffer) => acc + buffer.length, 0);
      console.log(`Total merged length will be: ${totalLength} samples`);
      
      // Create merged buffer
      const mergedBuffer = audioContext.createBuffer(
        decodedBuffers[0].numberOfChannels,
        totalLength,
        decodedBuffers[0].sampleRate
      );

      let offset = 0;
      const MERGE_CHUNK_SIZE = 50000; // Reduced for stability

      for (let i = 0; i < decodedBuffers.length; i++) {
        const buffer = decodedBuffers[i];
        console.log(`Merging buffer ${i + 1} of ${decodedBuffers.length}`);
        
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const mergedChannelData = mergedBuffer.getChannelData(channel);
          const bufferChannelData = buffer.getChannelData(channel);
          
          for (let j = 0; j < bufferChannelData.length; j += MERGE_CHUNK_SIZE) {
            const chunk = bufferChannelData.subarray(
              j,
              Math.min(j + MERGE_CHUNK_SIZE, bufferChannelData.length)
            );
            mergedChannelData.set(chunk, offset + j);
            
            if (j % (MERGE_CHUNK_SIZE * 5) === 0) {
              await new Promise(resolve => setTimeout(resolve, 1));
            }
          }
        }
        offset += buffer.length;
        progressCallback((i + 1) / decodedBuffers.length);
      }

      console.log('Audio merging completed successfully');
      return mergedBuffer;
    } catch (error) {
      console.error('Error in mergeAudioBuffers:', error);
      throw error;
    }
  }

  async convertToMP3Chunked(audioBuffer, progressCallback) {
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
    const totalChunks = Math.ceil(channels[0].length / (sampleBlockSize * CHUNKS_PER_ITERATION));
    let processedChunks = 0;
    
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
      
      processedChunks++;
      progressCallback(processedChunks / totalChunks);
      
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