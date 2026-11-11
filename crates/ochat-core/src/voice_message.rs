//! Bounded, interoperable mono PCM recordings. No plaintext files are created.
use anyhow::{Result, ensure};
pub const RATE: usize = 48_000;
pub const MAX_SAMPLES: usize = RATE * 180;
pub fn encode_wav(samples: &[f32]) -> Result<Vec<u8>> {
    ensure!(
        !samples.is_empty() && samples.len() <= MAX_SAMPLES,
        "Record between a moment and three minutes of audio"
    );
    let size = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + size as usize);
    bytes.extend(b"RIFF");
    bytes.extend((size + 36).to_le_bytes());
    bytes.extend(b"WAVEfmt ");
    bytes.extend(16u32.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend((RATE as u32).to_le_bytes());
    bytes.extend((RATE as u32 * 2).to_le_bytes());
    bytes.extend(2u16.to_le_bytes());
    bytes.extend(16u16.to_le_bytes());
    bytes.extend(b"data");
    bytes.extend(size.to_le_bytes());
    for &sample in samples {
        let sample = if sample.is_finite() {
            sample.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        bytes.extend(((sample * i16::MAX as f32).round() as i16).to_le_bytes());
    }
    Ok(bytes)
}
pub fn validate_wav(bytes: &[u8]) -> Result<()> {
    ensure!(
        bytes.len() >= 46
            && bytes.len() <= 44 + MAX_SAMPLES * 2
            && (bytes.len() - 44).is_multiple_of(2),
        "Invalid voice message"
    );
    let canonical = encode_wav(&[0.0])?;
    ensure!(
        bytes[..4] == canonical[..4] && bytes[8..40] == canonical[8..40],
        "Invalid voice message format"
    );
    ensure!(
        u32::from_le_bytes(bytes[4..8].try_into()?) as usize == bytes.len() - 8
            && u32::from_le_bytes(bytes[40..44].try_into()?) as usize == bytes.len() - 44,
        "Invalid voice message length"
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interoperable_bounded_pcm_and_corruption_rejection() {
        let bytes = encode_wav(&[0.0, 1.0, -1.0, f32::NAN, 5.0]).unwrap();
        validate_wav(&bytes).unwrap();
        assert_eq!(crate::chat_media::media_mime(&bytes), Some("audio/wav"));
        assert_eq!(&bytes[44..], &[0, 0, 255, 127, 1, 128, 0, 0, 255, 127]);
        assert!(validate_wav(&bytes[..bytes.len() - 2]).is_err());
        assert!(encode_wav(&[]).is_err());
        assert!(encode_wav(&vec![0.0; MAX_SAMPLES + 1]).is_err());
        let mut bad = bytes;
        bad[22] = 2;
        assert!(validate_wav(&bad).is_err());
    }
}
