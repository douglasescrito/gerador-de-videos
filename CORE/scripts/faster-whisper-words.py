"""Driver do backend candidato (faster-whisper / CTranslate2).

Roda em ambiente isolado e escreve exatamente o mesmo JSON que o CLI oficial do
Whisper produz com --word_timestamps: { "text": ..., "segments": [ { "words":
[ { "word", "start", "end", "probability" } ] } ] }.

Manter o formato idêntico é o que permite comparar os dois motores palavra a
palavra sem nenhuma adaptação no alinhamento — o candidato só é promovido se a
comparação passar.
"""

import argparse
import json
import os
import sys
import tempfile


def parse_args():
    parser = argparse.ArgumentParser(description="Transcreve com timestamps por palavra usando faster-whisper.")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="pt")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    parser.add_argument("--compute-type", dest="compute_type", default="float32")
    parser.add_argument("--beam-size", dest="beam_size", type=int, default=5)
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        print(
            "faster-whisper nao esta instalado neste interpretador (%s). "
            'Use um ambiente isolado: pip install faster-whisper' % exc,
            file=sys.stderr,
        )
        return 2

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, _info = model.transcribe(
        args.audio,
        language=args.language,
        word_timestamps=True,
        beam_size=args.beam_size,
    )

    payload = {"text": "", "segments": []}
    texts = []
    for index, segment in enumerate(segments):
        words = []
        for word in (segment.words or []):
            words.append({
                "word": word.word,
                "start": round(float(word.start), 3),
                "end": round(float(word.end), 3),
                "probability": round(float(word.probability), 4),
            })
        texts.append(segment.text)
        payload["segments"].append({
            "id": index,
            "start": round(float(segment.start), 3),
            "end": round(float(segment.end), 3),
            "text": segment.text,
            "words": words,
        })
    payload["text"] = "".join(texts).strip()

    # Escrita atomica: um JSON truncado por interrupcao viraria "medicao" falsa.
    directory = os.path.dirname(os.path.abspath(args.out)) or "."
    os.makedirs(directory, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=directory, suffix=".tmp")
    with os.fdopen(handle, "w", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False)
    os.replace(temporary, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
