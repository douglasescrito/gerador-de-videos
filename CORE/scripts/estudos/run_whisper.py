"""Legacy local helper. Studio's align command remains the production entry point."""
import json
import os
import sys


def transcribe(audio_path, output_json_path):
    if not os.path.isfile(audio_path):
        raise FileNotFoundError("Input audio does not exist")
    if os.path.lexists(output_json_path):
        raise FileExistsError("Output already exists; choose a new destination")
    # Optional dependency from the operator's Python environment.
    import whisper

    model = whisper.load_model("base")
    result = model.transcribe(audio_path, language="pt", word_timestamps=True)
    # Exclusive create also protects a destination created while Whisper ran.
    with open(output_json_path, "x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    print("Local transcription JSON written")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python run_whisper.py <audio_path> <new_output_json_path>")
        sys.exit(1)
    transcribe(sys.argv[1], sys.argv[2])
