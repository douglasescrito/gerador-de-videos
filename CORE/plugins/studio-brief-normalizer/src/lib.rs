use std::{mem, slice};

use serde_json::{json, Value};

#[no_mangle]
pub extern "C" fn mesa_plugin_api_version() -> i32 {
    1
}

#[no_mangle]
pub extern "C" fn alloc(length: i32) -> i32 {
    if length <= 0 || length > 256 * 1024 {
        return -1;
    }
    let mut buffer = Vec::<u8>::with_capacity(length as usize);
    let pointer = buffer.as_mut_ptr();
    mem::forget(buffer);
    pointer as i32
}

#[no_mangle]
pub unsafe extern "C" fn run(input_pointer: i32, input_length: i32) -> i64 {
    if input_pointer < 0 || input_length <= 0 || input_length > 256 * 1024 {
        return output(json!({ "error": "entrada inválida" }));
    }
    let bytes = slice::from_raw_parts(input_pointer as *const u8, input_length as usize);
    let parsed: Value = match serde_json::from_slice(bytes) {
        Ok(value) => value,
        Err(_) => return output(json!({ "error": "JSON inválido" })),
    };
    let original = parsed
        .get("userPrompt")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let normalized = original.split_whitespace().collect::<Vec<_>>().join(" ");
    let lowercase = normalized.to_lowercase();
    let camera_terms = [
        "câmera",
        "camera",
        "plano",
        "close",
        "travelling",
        "dolly",
        "panorâmica",
    ];
    let audio_terms = [
        "som",
        "áudio",
        "audio",
        "música",
        "musica",
        "voz",
        "narração",
    ];
    output(json!({
        "userPrompt": normalized,
        "analysis": {
            "characters": normalized.chars().count(),
            "words": normalized.split_whitespace().count(),
            "whitespaceNormalized": normalized != original,
            "mentionsCameraDirection": camera_terms.iter().any(|term| lowercase.contains(term)),
            "mentionsAudio": audio_terms.iter().any(|term| lowercase.contains(term)),
            "mode": "studio-only-proposal"
        }
    }))
}

fn output(value: Value) -> i64 {
    let mut bytes = serde_json::to_vec(&value)
        .unwrap_or_else(|_| br#"{"error":"falha de serializacao"}"#.to_vec());
    let pointer = bytes.as_mut_ptr() as u32;
    let length = bytes.len() as u32;
    mem::forget(bytes);
    ((pointer as i64) << 32) | length as i64
}
