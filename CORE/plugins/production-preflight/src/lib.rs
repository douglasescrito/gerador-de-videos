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
    let prompt_ok = parsed
        .get("userPrompt")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let collection_ok = parsed
        .get("collection")
        .and_then(Value::as_str)
        .map(|value| {
            let trimmed = value.trim();
            !trimmed.is_empty()
                && !trimmed.contains('/')
                && !trimmed.contains('\\')
                && trimmed != "."
                && trimmed != ".."
        })
        .unwrap_or(false);
    let has_references = parsed
        .get("hasReferences")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let confirm_provider_input = parsed
        .get("confirmProviderInput")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let provider_input_ok = !has_references || confirm_provider_input;
    let ready = prompt_ok && collection_ok && provider_input_ok;
    output(json!({
        "readyToSubmit": ready,
        "providerCalls": 0,
        "checks": [
            { "id": "prompt", "ok": prompt_ok, "label": "prompt literal presente" },
            { "id": "collection", "ok": collection_ok, "label": "coleção local válida" },
            { "id": "confirm-provider-input", "ok": provider_input_ok, "label": "referências externas confirmadas quando aplicável" }
        ],
        "decision": if ready { "human-may-submit" } else { "blocked-before-provider" },
        "retryAuthority": "none"
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
