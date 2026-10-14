import com.mct.audio.GameAudioCapture;
import com.mct.core.recording.AudioCapture;
import java.util.concurrent.*;
import org.lwjgl.openal.*;
import static org.lwjgl.openal.ALC10.*;

/** Synthetic timing fixture only. Not Minecraft audiovisual demonstration evidence. */
public class AudioTimingSmoke {
 static void reset(){ AudioCapture.blocks=0;AudioCapture.first=AudioCapture.last=AudioCapture.energy=0;AudioCapture.failure=null; }
 static void check(boolean ok,String msg){if(!ok)throw new AssertionError(msg);}
 static void scenario(boolean timeout)throws Exception {
  reset(); ExecutorService executor=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"synthetic-sound-executor");t.setDaemon(true);return t;});
  GameAudioCapture capture=new GameAudioCapture(executor);long d=capture.open(null,false);check(d!=0,capture.unavailableReason());long c=capture.context(d);
  alcMakeContextCurrent(c);AL.createCapabilities(ALC.createCapabilities(d));capture.start(d,c);Thread.sleep(120);
  CountDownLatch entered=new CountDownLatch(1);
  executor.execute(()->{entered.countDown();try{Thread.sleep(timeout?250:45);}catch(InterruptedException e){Thread.currentThread().interrupt();}});
  entered.await();Thread.sleep(timeout?330:180);
  if(timeout){check(capture.needsReload(),"Stall not marked for recovery");check(AudioCapture.failure!=null,"Stall did not fail explicitly");}
  else {check(AudioCapture.failure==null,"Unexpected failure "+AudioCapture.failure);check(((Long)capture.timingStats().get("clockResyncs"))>=1,"No forward resync");check(((Long)capture.timingStats().get("clockGapNanos"))>20_000_000L,"Missing observable gap");check(((Long)capture.timingStats().get("maximumTimestampLagNanos"))<=10_000_000L,"Backdated game state");}
  long before=System.nanoTime();check(capture.close(),"Close unsafe");check(System.nanoTime()-before<2_100_000_000L,"Unbounded shutdown");
  int count=AudioCapture.blocks;Thread.sleep(40);check(count==AudioCapture.blocks,"PCM after close");
  alcMakeContextCurrent(0);alcDestroyContext(c);alcCloseDevice(d);executor.shutdownNow();
  System.out.println("PASS "+(timeout?"250ms executor stall fails, delayed callback cannot use closed device":"45ms queued mutation stall resyncs forward, no historical catch-up")+" stats="+capture.timingStats()+" blocks="+count);
 }
 public static void main(String[]args)throws Exception{scenario(false);scenario(true);}
}
