// vision <image> -> JSON lines on stdout: {"text":"…","x":0,"y":0,"w":0,"h":0,"conf":0.0}
//
// OCR with the macOS Vision framework (no network, no model download). Coordinates are in PIXELS of the image with the
// origin at the TOP-left (Vision's normalised bottom-left boxes are converted here). Exit codes: 0 ok · 2 bad usage ·
// 1 the image could not be read or recognised.
import Foundation
import Vision
import AppKit

func die(_ code: Int32, _ message: String) -> Never {
	FileHandle.standardError.write(Data("vision: \(message)\n".utf8))
	exit(code)
}

guard CommandLine.arguments.count == 2 else { die(2, "usage: vision <image>") }
let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path),
	let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else { die(1, "cannot read \(path)") }

let width = Double(cg.width)
let height = Double(cg.height)
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.minimumTextHeight = 0

do {
	try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
} catch {
	die(1, "recognition failed: \(error.localizedDescription)")
}

for obs in request.results ?? [] {
	guard let top = obs.topCandidates(1).first else { continue }
	let b = obs.boundingBox
	let row: [String: Any] = [
		"text": top.string,
		"x": (b.minX * width).rounded(),
		"y": ((1 - b.maxY) * height).rounded(),
		"w": (b.width * width).rounded(),
		"h": (b.height * height).rounded(),
		"conf": Double(top.confidence),
	]
	if let data = try? JSONSerialization.data(withJSONObject: row), let line = String(data: data, encoding: .utf8) {
		print(line)
	}
}
