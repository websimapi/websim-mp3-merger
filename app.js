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
    progressBar.style.display = 'block';
    
    try {
      // Convert files to ArrayBuffers
      const audioBuffers = await Promise.all(
        this.files.map(file => this.readFileAsArrayBuffer(file))
      );

      // Merge the audio data
      const mergedBlob = await this.mergeAudioBuffers(audioBuffers, (progress) => {
        progressFill.style.width = `${progress * 100}%`;
      });

      // Create download link
      const url = URL.createObjectURL(mergedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'merged.mp3';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      progressBar.style.display = 'none';
      progressFill.style.width = '0%';
    } catch (error) {
      console.error('Error merging files:', error);
      alert('Error merging files. Please try again.');
      progressBar.style.display = 'none';
      progressFill.style.width = '0%';
    }
  }

  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  async mergeAudioBuffers(audioBuffers, progressCallback) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const decodedBuffers = await Promise.all(
      audioBuffers.map(buffer => audioContext.decodeAudioData(buffer))
    );

    // Calculate total length
    const totalLength = decodedBuffers.reduce((acc, buffer) => acc + buffer.length, 0);
    
    // Create merged buffer
    const mergedBuffer = audioContext.createBuffer(
      decodedBuffers[0].numberOfChannels,
      totalLength,
      decodedBuffers[0].sampleRate
    );

    let offset = 0;
    for (let i = 0; i < decodedBuffers.length; i++) {
      const buffer = decodedBuffers[i];
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const mergedChannelData = mergedBuffer.getChannelData(channel);
        const bufferChannelData = buffer.getChannelData(channel);
        mergedChannelData.set(bufferChannelData, offset);
      }
      offset += buffer.length;
      progressCallback((i + 1) / decodedBuffers.length);
    }

    // Convert to MP3
    const mp3Data = this.convertToMP3(mergedBuffer);
    return new Blob([mp3Data], { type: 'audio/mpeg' });
  }

  convertToMP3(audioBuffer) {
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
    
    for (let i = 0; i < channels[0].length; i += sampleBlockSize) {
      const left = channels[0].slice(i, i + sampleBlockSize);
      const right = channels[1] ? channels[1].slice(i, i + sampleBlockSize) : left;
      
      const leftInt16 = new Int16Array(left.map(n => n * 0x7FFF));
      const rightInt16 = new Int16Array(right.map(n => n * 0x7FFF));
      
      const mp3buf = mp3Encoder.encodeBuffer(leftInt16, rightInt16);
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
    }

    const end = mp3Encoder.flush();
    if (end.length > 0) {
      mp3Data.push(end);
    }

    return new Uint8Array(mp3Data.reduce((acc, cur) => [...acc, ...cur], []));
  }
}

const mp3Merger = new MP3Merger();