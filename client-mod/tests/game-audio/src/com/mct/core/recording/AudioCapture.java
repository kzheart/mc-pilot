package com.mct.core.recording;
public class AudioCapture {
 public interface Provider {String name(); String unavailableReason();}
 public static volatile int blocks; public static volatile long first, last; public static volatile long energy; public static volatile String failure;
 public static void register(Provider p){} public static void unregister(Provider p,String s){}
 public static synchronized boolean submit(Provider p,byte[] b,int o,int f,long n){if(f!=480||o!=0||b.length!=1920)throw new AssertionError(); if(blocks>0&&n-last<10000000L)throw new AssertionError("clock delta "+(n-last));if(blocks==0)first=n;last=n;blocks++;for(int i=0;i<b.length;i+=2)energy+=Math.abs((short)((b[i]&255)|(b[i+1]<<8)));return true;}
 public static void signalFailure(Provider p,String s){failure=s;}
}
