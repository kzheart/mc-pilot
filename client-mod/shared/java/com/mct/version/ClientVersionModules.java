package com.mct.version;

public final class ClientVersionModules {

    private final TextAdapter text;
    private final ScoreboardAdapter scoreboard;
    private final ResourcePackAdapter resourcePack;
    private final ReconnectAdapter reconnect;
    private final SignAdapter sign;
    private final BookAdapter book;
    private final ItemDataAdapter itemData;
    private final ActionResultAdapter actionResult;
    private final NetworkAdapter network;
    private final ImageAdapter image;
    private final InteractionAdapter interaction;

    public ClientVersionModules(
        TextAdapter text,
        ScoreboardAdapter scoreboard,
        ResourcePackAdapter resourcePack,
        ReconnectAdapter reconnect,
        SignAdapter sign,
        BookAdapter book,
        ItemDataAdapter itemData,
        ActionResultAdapter actionResult,
        NetworkAdapter network,
        ImageAdapter image,
        InteractionAdapter interaction
    ) {
        this.text = text;
        this.scoreboard = scoreboard;
        this.resourcePack = resourcePack;
        this.reconnect = reconnect;
        this.sign = sign;
        this.book = book;
        this.itemData = itemData;
        this.actionResult = actionResult;
        this.network = network;
        this.image = image;
        this.interaction = interaction;
    }

    public TextAdapter text() {
        return text;
    }

    public ScoreboardAdapter scoreboard() {
        return scoreboard;
    }

    public ResourcePackAdapter resourcePack() {
        return resourcePack;
    }

    public ReconnectAdapter reconnect() {
        return reconnect;
    }

    public SignAdapter sign() {
        return sign;
    }

    public BookAdapter book() {
        return book;
    }

    public ItemDataAdapter itemData() {
        return itemData;
    }

    public ActionResultAdapter actionResult() {
        return actionResult;
    }

    public NetworkAdapter network() {
        return network;
    }

    public ImageAdapter image() {
        return image;
    }

    public InteractionAdapter interaction() {
        return interaction;
    }
}
