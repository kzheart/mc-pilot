#!/usr/bin/env python3
"""Run real feedback code against small API-shaped doubles, without game downloads.

This is a behavior regression harness, not a substitute for compiling game variants.
The production interface and each production interaction factory are compiled verbatim.
Only unrelated adapter factories are omitted; the legacy helper is compiled in full.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
JAVA = os.environ.get('JAVA', 'java')
JAVAC = [os.environ['JAVAC']] if os.environ.get('JAVAC') else ([shutil.which('javac')] if shutil.which('javac') else [JAVA, '--module', 'jdk.compiler/com.sun.tools.javac.Main'])


def method(text, marker):
    start = text.index(marker)
    opening = text.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    return text[start:end]


def run_case(version, family):
    official = family == 'official'
    legacy = family == 'legacy'
    modern = official or family == 'yarn-modern'
    mapping = {
        'Client': 'net.minecraft.client.Minecraft' if official or legacy else 'net.minecraft.client.MinecraftClient',
        'Player': 'net.minecraft.client.player.LocalPlayer' if official else 'net.minecraft.client.entity.EntityPlayerSP' if legacy else 'net.minecraft.client.network.ClientPlayerEntity',
        'Manager': 'net.minecraft.client.multiplayer.MultiPlayerGameMode' if official else 'net.minecraft.client.multiplayer.PlayerControllerMP' if legacy else 'net.minecraft.client.network.ClientPlayerInteractionManager',
        'Stack': 'net.minecraft.world.item.ItemStack' if official else 'net.minecraft.item.ItemStack',
        'Hand': 'net.minecraft.world.InteractionHand' if official else 'net.minecraft.util.EnumHand' if legacy else 'net.minecraft.util.Hand',
        'Result': 'net.minecraft.world.InteractionResult' if official else 'net.minecraft.util.EnumActionResult' if legacy else 'net.minecraft.util.ActionResult',
        'Hit': 'net.minecraft.world.phys.BlockHitResult' if official else 'net.minecraft.util.hit.BlockHitResult',
        'Pos': 'net.minecraft.util.math.BlockPos',
        'Face': 'net.minecraft.util.EnumFacing',
        'Vec': 'net.minecraft.util.math.Vec3d',
    }
    methods = {
        'getHeldStack': 'getItemInHand' if official else 'getHeldItem' if legacy else 'getStackInHand',
        'playSwing': 'swing' if official else 'swingArm' if legacy else 'swingHand',
        'resetEquip': 'itemUsed' if official else 'resetEquippedProgress' if legacy else 'resetEquipProgress',
        'rawBlock': 'useItemOn' if official else 'processRightClickBlock' if legacy else 'interactBlock',
        'rawItem': 'useItem' if official else 'interactItem',
        'isUnlimited': 'isInCreativeMode' if legacy else 'hasCreativeInventory',
        'isPlayerUnlimited': 'hasInfiniteMaterials' if official else 'isInCreativeMode',
        'rendererField': 'itemInHandRenderer' if official else 'firstPersonRenderer',
    }
    imports = '\n'.join('import ' + n + ';' for n in mapping.values())
    def expand(s):
        for alias, full in mapping.items():
            s = re.sub(r'\b' + alias + r'\b', full.split('.')[-1], s)
        for alias, actual in methods.items():
            s = re.sub(r'\b' + alias + r'\b', actual, s)
        return s
    with tempfile.TemporaryDirectory(prefix='mct-interaction-') as tmp:
        src, out = Path(tmp) / 'src', Path(tmp) / 'classes'
        def write(full, body):
            p = src / (full.replace('.', '/') + '.java')
            p.parent.mkdir(parents=True, exist_ok=True)
            package = full.rsplit('.', 1)[0]
            p.write_text('package ' + package + ';\n' + imports + '\n' + expand(body))
        def stub(alias, body):
            write(mapping[alias], body)
        stub('Hand', 'public enum Hand { MAIN_HAND, OFF_HAND }')
        for alias in ['Hit', 'Pos', 'Vec']:
            stub(alias, 'public final class ' + alias + ' {}')
        stub('Face', 'public enum Face { UP }')
        stub('Stack', '''public final class Stack {
            public int count; public Stack(int count) { this.count = count; }
            public int getCount() { return count; } public boolean isEmpty() { return count <= 0; }
        }''')
        if modern:
            stub('Result', '''public interface Result {
                enum SwingSource { CLIENT, SERVER, NONE }
                record Success(SwingSource swingSource) implements Result {}
                Result SUCCESS = new Success(SwingSource.CLIENT);
                Result SUCCESS_SERVER = new Success(SwingSource.SERVER);
                Result CUSTOM_CLIENT_SUCCESS = new Success(SwingSource.CLIENT);
                Result CONSUME = new Success(SwingSource.NONE);
                Result PASS = new Result() {}; Result FAIL = new Result() {};
                Result PASS_TO_DEFAULT_BLOCK_ACTION = new Result() {};
            }''')
            results = 'Result.SUCCESS, Result.SUCCESS_SERVER, Result.CONSUME, Result.PASS, Result.FAIL, Result.PASS_TO_DEFAULT_BLOCK_ACTION, Result.CUSTOM_CLIENT_SUCCESS'
        elif legacy:
            stub('Result', 'public enum Result { SUCCESS, PASS, FAIL }')
            results = 'Result.values()'
        else:
            stub('Result', '''public enum Result {
                SUCCESS(true, true), SUCCESS_NO_ITEM_USED(true, true), CONSUME(true, false), CONSUME_PARTIAL(true, false), PASS(false, false), FAIL(false, false), UNACCEPTED_SWING(false, true);
                final boolean accepted, swing;
                Result(boolean accepted, boolean swing) { this.accepted=accepted; this.swing=swing; }
                public boolean isAccepted() { return accepted; } public boolean shouldSwingHand() { return swing; }
            }''')
            results = 'Result.values()'
        stub('Player', '''public final class Player {
            public Stack stack; public boolean creative; public int swings; public Hand swungHand;
            public Object clientWorld = new Object(); public Network networkHandler = new Network();
            public Network connection = networkHandler;
            public Stack getHeldStack(Hand hand) { test.Trace.handRead = hand; return stack; }
            public void playSwing(Hand hand) { swings++; swungHand=hand; test.Trace.events.add("swing"); }
            public boolean isPlayerUnlimited() { return creative; }
            public void sendChatMessage(String value) {}
            public static final class Network {
                public boolean sendCommand(String value) { return true; }
                public void sendChatCommand(String value) {} public void sendChatMessage(String value) {}
                public void sendChat(String value) {}
            }
        }''')
        raw_params = 'Player player, Object world, Pos pos, Face face, Vec hit, Hand hand' if legacy else 'Player player, Hand hand, Hit hit'
        stub('Manager', '''public final class Manager {
            public boolean creative, replace, fail; public int after, calls; public Result result;
            public Player seenPlayer; public Hand seenHand; public Object seenHit;
            public boolean isUnlimited() { return creative; }
            public Result rawBlock(''' + raw_params + ''') {
                calls++; seenPlayer=player; seenHand=hand; seenHit=hit; test.Trace.events.add("interact");
                if (fail) throw new IllegalStateException("interaction failed");
                if (replace) player.stack = new Stack(after); else player.stack.count=after;
                return result;
            }
        ''' + ('' if legacy else '''
            public Result rawBlock(Player player, Object world, Hand hand, Hit hit) { return rawBlock(player, hand, hit); }
            public Result rawItem(Player player, Hand hand) { return result; }
            public Result rawItem(Player player, Object world, Hand hand) { return result; }
        ''') + '}')
        stub('Client', '''public final class Client {
            public Object world = new Object(); public GameRenderer gameRenderer = new GameRenderer();
            public Renderer getItemRenderer() { return gameRenderer.rendererField; }
            public static final class GameRenderer { public Renderer rendererField = new Renderer(); }
            public static final class Renderer {
                public int resets; public Hand resetHand;
                public void resetEquip(Hand hand) { resets++; resetHand=hand; test.Trace.events.add("reset"); }
            }
        }''')
        write('test.Trace', '''public final class Trace {
            public static final java.util.List<String> events = new java.util.ArrayList<>();
            public static Hand handRead;
        }''')
        if legacy:
            prod = ROOT / 'client-mod/shared/forge-1.12/java/com/mct/legacy/BlockInteractionFeedback.java'
            dest = src / 'com/mct/legacy/BlockInteractionFeedback.java'
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(prod, dest)
            setup = ''
            invoke = 'BlockInteractionFeedback.interact(client, manager, player, new Pos(), Face.UP, hit, hand)'
            hit_type = 'Vec'
        else:
            kind = 'java-official' if official else 'java'
            prod = ROOT / f'client-mod/shared/{kind}/com/mct/version/InteractionAdapter.java'
            dest = src / 'com/mct/version/InteractionAdapter.java'
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(prod, dest)
            adapter_path = ROOT / ('client-mod/mc26/version-26.2/src/main/java/com/mct/version/impl/VersionAdaptersImpl.java' if official else f'client-mod/version-{version}/src/main/java/com/mct/version/impl/VersionAdaptersImpl.java')
            factory = method(adapter_path.read_text(), 'private static InteractionAdapter createInteractionAdapter()').replace('private static', 'public static', 1)
            write('com.mct.version.impl.VersionAdaptersImpl', 'import com.mct.version.InteractionAdapter;\npublic final class VersionAdaptersImpl {\n' + factory + '\n}')
            setup = 'com.mct.version.InteractionAdapter adapter = com.mct.version.impl.VersionAdaptersImpl.createInteractionAdapter();'
            invoke = 'adapter.interactBlockWithFeedback(client, manager, player, hand, hit)'
            hit_type = 'Hit'
        player_materials = official or version == '1.21.11'
        result_array = 'new Result[] {' + results + '}' if modern else results
        body = '''public final class FeedbackTest {
            private static void check(boolean value, String why) { if (!value) throw new AssertionError(why); }
            public static void main(String[] args) {
                SETUP
                int cases=0;
                for (Result expectedResult : RESULTS) for (Hand hand : Hand.values())
                for (boolean creative : new boolean[] {false,true}) for (boolean playerCreative : new boolean[] {false,true})
                for (int before : new int[] {0,1,5}) for (int after : new int[] {0,1,4,5})
                for (boolean replace : new boolean[] {false,true}) {
                    Client client=new Client(); Player player=new Player(); Manager manager=new Manager();
                    player.stack=new Stack(before); Stack original=player.stack; player.creative=playerCreative;
                    manager.creative=creative; manager.after=after; manager.replace=replace; manager.result=expectedResult;
                    HIT_TYPE hit=new HIT_TYPE(); test.Trace.events.clear(); test.Trace.handRead=null;
                    Result actual=INVOKE;
                    boolean swing=SWING_EXPECTATION;
                    int postCount=replace ? before : after;
                    boolean reset=swing && postCount>0 && (postCount!=before || CREATIVE_SOURCE);
                    check(actual==expectedResult, "result identity changed");
                    check(manager.calls==1 && manager.seenPlayer==player && manager.seenHand==hand && manager.seenHit==hit, "raw call count/arguments");
                    check(test.Trace.handRead==hand, "captured wrong hand");
                    check(player.swings==(swing?1:0) && (!swing || player.swungHand==hand), "swing policy/hand");
                    check(client.gameRenderer.rendererField.resets==(reset?1:0), "equip reset policy: before="+before+", after="+after+", replacement="+replace);
                    check(!reset || client.gameRenderer.rendererField.resetHand==hand, "equip hand");
                    java.util.List<String> expected=new java.util.ArrayList<>(); expected.add("interact");
                    if(swing) expected.add("swing"); if(reset) expected.add("reset");
                    check(test.Trace.events.equals(expected), "feedback order/double feedback"); cases++;
                }
                Client client=new Client(); Player player=new Player(); Manager manager=new Manager();
                player.stack=new Stack(5); manager.fail=true; Hand hand=Hand.MAIN_HAND; HIT_TYPE hit=new HIT_TYPE();
                test.Trace.events.clear();
                try { INVOKE; throw new AssertionError("exception swallowed"); }
                catch (IllegalStateException expected) { check(expected.getMessage().equals("interaction failed"), "exception changed"); }
                check(player.swings==0 && client.gameRenderer.rendererField.resets==0 && manager.calls==1, "feedback after failure");
                System.out.println("VERSION: " + cases + " feedback cases + exception propagation passed");
            }
        }'''
        for key, value in {'SETUP':setup, 'RESULTS':result_array, 'HIT_TYPE':hit_type, 'INVOKE':invoke, 'CREATIVE_SOURCE':'playerCreative' if player_materials else 'creative', 'VERSION':version, 'SWING_EXPECTATION': 'expectedResult == Result.SUCCESS || expectedResult == Result.CUSTOM_CLIENT_SUCCESS' if modern else 'expectedResult == Result.SUCCESS' if legacy else 'expectedResult == Result.SUCCESS || expectedResult == Result.SUCCESS_NO_ITEM_USED'}.items():
            body=body.replace(key,value)
        write('com.mct.legacy.FeedbackTest', body)
        subprocess.run(JAVAC + ['--release', '8' if legacy else '17', '-d', str(out)] + [str(p) for p in src.rglob('*.java')], check=True)
        subprocess.run([JAVA, '-cp', str(out), 'com.mct.legacy.FeedbackTest'], check=True)


def check_wiring():
    for kind in ['java', 'java-official']:
        base=ROOT / f'client-mod/shared/{kind}/com/mct/core/handler'
        for name, count in [('WorldHandler.java',2), ('SignBookHandler.java',1)]:
            source=(base/name).read_text()
            assert source.count('.interaction().interactBlockWithFeedback(')==count, (kind,name)
            assert '.interaction().interactBlock(' not in source, (kind,name)
    for name in ['WorldActions.java','SignBookActions.java']:
        source=(ROOT / 'client-mod/shared/forge-1.12/java/com/mct/legacy'/name).read_text()
        assert 'BlockInteractionFeedback.interact(' in source and 'processRightClickBlock(' not in source, name
    catalog=json.loads((ROOT/'client-mod/variants.json').read_text())['variants']
    for variant in catalog:
        module=ROOT/'client-mod'/variant.get('gradleBuild','')/variant['gradleModule']
        files=list(module.glob('build.gradle*'))
        assert len(files)==1, variant['id']
        source=files[0].read_text()
        expected='shared/forge-1.12/java' if variant['minecraftVersion']=='1.12.2' else 'shared/java-official' if variant['minecraftVersion'].startswith('26.') else 'shared/java'
        assert expected in source, variant['id']
    print(f"Handler routing and shared source wiring checked for {len(catalog)} declared variants", flush=True)


if __name__=='__main__':
    check_wiring()
    for version in ['1.18.2','1.20.1','1.20.2','1.20.4','1.21.1']:
        run_case(version,'yarn-old')
    for version in ['1.21.4','1.21.11']:
        run_case(version,'yarn-modern')
    for version in ['26.1','26.2']:
        run_case(version,'official')
    run_case('1.12.2','legacy')
