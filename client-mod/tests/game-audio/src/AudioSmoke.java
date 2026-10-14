import com.mct.audio.GameAudioCapture;
import com.mct.core.recording.AudioCapture;
import java.nio.*;
import org.lwjgl.openal.*;
import org.lwjgl.BufferUtils;
import static org.lwjgl.openal.AL10.*;
import static org.lwjgl.openal.ALC10.*;
public class AudioSmoke {
 public static void main(String[]args)throws Exception {
  GameAudioCapture capture=new GameAudioCapture(java.util.concurrent.Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r); t.setDaemon(true); return t; })); long d=capture.open(null,false);
  if(d==0)throw new AssertionError(capture.unavailableReason());
  if(capture.outputDeviceName()==null||capture.outputDeviceName().equals("Loopback"))throw new AssertionError("Normal playback device identity lost");
  long c=capture.context(d); if(!alcMakeContextCurrent(c))throw new AssertionError();
  ALCCapabilities caps=ALC.createCapabilities(d);AL.createCapabilities(caps);
  // Simulate vanilla's current-device-name query, including its fallback.
  String name=alcGetString(d,4115);if(name==null)name=alcGetString(d,ALC_DEVICE_SPECIFIER);
  System.out.println("Loopback name="+name+", name query error="+alcGetError(d));
  int b=alGenBuffers(),s=alGenSources();ShortBuffer test=BufferUtils.createShortBuffer(48000);for(int i=0;i<48000;i++)test.put((short)(i%100<50?1000:-1000));test.flip();
  alBufferData(b,AL_FORMAT_MONO16,test,48000);alSourcei(s,AL_BUFFER,b);alSourcePlay(s);
  capture.start(d,c);Thread.sleep(1200);
  if(alcGetCurrentContext()!=c)throw new AssertionError("Game process context changed");
  if(AL.getCapabilities()==null)throw new AssertionError();
  capture.close();int blocks=AudioCapture.blocks;Thread.sleep(40);if(AudioCapture.blocks!=blocks)throw new AssertionError("Still submitting after close");
  alDeleteSources(s);alDeleteBuffers(b);alcMakeContextCurrent(0);alcDestroyContext(c);alcCloseDevice(d);
  if(AudioCapture.failure!=null)throw new AssertionError(AudioCapture.failure);
  if(blocks<110||blocks>130||AudioCapture.energy==0)throw new AssertionError("blocks="+blocks+" energy="+AudioCapture.energy);
  System.out.println("PASS real OpenAL loopback + output tee, blocks="+blocks+", exact monotonic 10ms clock, energy="+AudioCapture.energy+", process context preserved, joined before device close");
 }
}
