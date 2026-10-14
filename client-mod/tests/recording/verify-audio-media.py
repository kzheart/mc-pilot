#!/usr/bin/env python3
"""Synthetic PCM plumbing tests; actual game-mix provenance needs runtime evidence."""
import array, json, math, pathlib, subprocess, sys
root = pathlib.Path(sys.argv[1])
def probe(name):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(root/name)]))['streams']
av = probe('audio-aligned.mp4')
assert len(av) == 2, av
vs = next(s for s in av if s['codec_type']=='video'); au = next(s for s in av if s['codec_type']=='audio')
frames, samples = map(int, (root/'audio-expected.txt').read_text().splitlines())
assert vs['codec_name']=='h264' and int(vs['nb_frames'])==frames, vs
assert au['codec_name']=='aac' and au['sample_rate']=='48000' and au['channels']==2, au
assert abs(float(au['duration'])-samples/48000)<.002, au
assert abs(float(vs['duration'])-float(au['duration']))<.002, (vs,au)
pcm = array.array('h',subprocess.check_output(['ffmpeg','-v','error','-i',str(root/'audio-aligned.mp4'),'-map','0:a:0','-f','s16le','pipe:1']))
if sys.byteorder!='little': pcm.byteswap()
def rms(start,end):
    values=pcm[int(start*48000)*2:int(end*48000)*2:2]
    return math.sqrt(sum(x*x for x in values)/len(values))
assert rms(0,.075)<5
assert rms(.12,.18)>3500 and rms(.24,.30)>3500
assert rms(.35,.39)<5
assert sum(pcm[i]*pcm[i+1] for i in range(12000,17000,2))<0
assert len(probe('audio-disabled.mp4'))==1
for name in ['audio-delayed-frame.mp4','audio-pending-stop.mp4']:
    data=subprocess.check_output(['ffmpeg','-v','error','-i',str(root/name),'-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
    colors=[tuple(data[i:i+3]) for i in range(0,len(data),32*24*3)]
    if name=='audio-delayed-frame.mp4':
        assert all(r>150 and b<50 for r,g,b in colors[:3]), colors
        assert all(b>150 and r<50 for r,g,b in colors[3:]), colors
    else: assert colors[-1][2]>150 and colors[-1][0]<50, colors
print('PASS decoded stereo48k AAC, gap placement, copied PCM, matching duration, default silence,95ms-late video retaining100ms PTS, and pre-stop drain')
