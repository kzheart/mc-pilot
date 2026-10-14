package com.mct.core.state;
public final class EventRecorder {
    private static final EventRecorder INSTANCE = new EventRecorder();
    public static EventRecorder getInstance() { return INSTANCE; }
    public Pointer drainPointer() { return new Pointer(); }
    public static final class Pointer { public int count; public String lastType; }
}
