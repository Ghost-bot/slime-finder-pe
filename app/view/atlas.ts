import '../../scss/atlas.scss';
import Bacon  = require('baconjs');
import Hammer = require('hammerjs');
import AtlasModel  from '../model/atlas';
import CoordsModel from '../model/coords';
import Chunk       from 'slime-finder/chunk';
import Point       from 'slime-finder/point';

declare var $: any;
Bacon.$.init($);

export default class AtlasView {
    /* The center of the atlas in the world coords */
    protected readonly center: Bacon.Observable<Point>;

    /* How the world coords are scaled to the local coords,
     * i.e. pixels */
    protected readonly scale: Bacon.Observable<number>;

    /* The canvas to render our atlas. */
    protected readonly canvas: HTMLCanvasElement;

    /* The atlas scale slider is so tightly related to the atlas so
     * we don't have a separate view for it. */
    protected readonly scaleSlider: HTMLInputElement;

    protected redraw(center: Point, scale: number): void {
        const ctx = this.canvas.getContext("2d");

        if (ctx) {
            /* First we need to clear the entire canvas.
             */
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.fillStyle = 'rgba(0, 0, 0, 0)';
            ctx.fill();

            /* For each chunk visible from the atlas we draw a rectangle
             * for it.
             */
            const topLeft = new Point(
                center.x - (this.canvas.width  / 2) / scale,
                center.z - (this.canvas.height / 2) / scale);
            const bottomRight = new Point(
                topLeft.x + this.canvas.width  / scale,
                topLeft.z + this.canvas.height / scale);

            /* A chunk is visible if any of its four corners is
             * visible.
             */
            const isPointVisible = (p: Point): boolean => {
                return p.x >= topLeft.x     && p.z >= topLeft.z
                    && p.x <  bottomRight.x && p.z <  bottomRight.z;
            };
            const isChunkVisible = (c: Chunk): boolean => {
                return isPointVisible(c.origin)
                    || isPointVisible(c.origin.offset(16,  0))
                    || isPointVisible(c.origin.offset( 0, 16))
                    || isPointVisible(c.origin.offset(16, 16));
            };
            const worldToAtlas = (p: Point): Point => {
                return new Point(
                    (p.x - topLeft.x) * scale,
                    (p.z - topLeft.z) * scale);
            };
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillStyle   = 'rgba(127, 255, 0, 0.4)';
            ctx.lineWidth   = 1.0;
            for (let c = new Chunk(topLeft); isChunkVisible(c); c = c.offset(0, 1)) {
                for (let d = c; isChunkVisible(d); d = d.offset(1, 0)) {
                    const origin = worldToAtlas(d.origin);
                    ctx.strokeRect(
                        Math.floor(origin.x), Math.floor(origin.z), 16 * scale, 16 * scale);
                    if (d.isSlimy) {
                        ctx.fillRect(
                            Math.floor(origin.x), Math.floor(origin.z), 16 * scale, 16 * scale);
                    }
                }
            }

            /* Draw a small circle at the center of atlas.
             */
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
            ctx.lineWidth   = 3.0;
            ctx.beginPath();
            ctx.arc(
                Math.floor(worldToAtlas(center).x), Math.floor(worldToAtlas(center).z),
                4.0, 0, 2 * Math.PI);
            ctx.stroke();
        }
    }

    constructor(atlas: AtlasModel) {
        /* The center of the atlas is determined by the value of
         * atlas.center property. The same goes for the scale.
         */
        this.center = atlas.center;
        this.scale  = atlas.scale;

        /* Resize the canvas and the scale slider according to its
         * container.
         */
        this.canvas      = <HTMLCanvasElement>$('.atlas-container canvas.atlas').get(0);
        this.scaleSlider = <HTMLInputElement>$('.atlas-container input.atlas-scale').get(0);

        /* When the size of window changes the canvas should be
         * resized accordingly.
         */
        let getSize = () => {
            return {w: $(window).width(), h: $(window).height()};
        };
        let size = $(window).asEventStream('resize')
            .throttle(50).map(getSize)
            .merge(Bacon.once(getSize()));

        /* The content of atlas is determined by the center, scale,
         * and size. Redraw it whenever either of them changes.
         */
        Bacon.combineAsArray<any>(this.center, this.scale, size).onValues(
            (c, sc, sz) => {
                this.canvas.width  = sz.w;
                this.canvas.height = Math.floor(sz.h * (50 / 100));

                /* And recalculate the height of the scale slider. I
                 * know this should be done solely in the style sheet
                 * but I can't find a way to do it. I'm a CSS noob. */
                $(this.scaleSlider).height(
                    Math.floor($(this.canvas).height() * (30 / 100)));

                this.redraw(c, sc);
            });

        /* The current value of the scale slider should be updated
         * whenever the scale changes.
         */
        this.scale.onValue((sc) => {
            this.scaleSlider.value = String(sc);
        });

        /* And the scale should be updated whenever the scale slider
         * changes.
         */
        let sliderScale = $(this.scaleSlider)
            .asEventStream('input')
            .map((e) => {
                return () => Number(this.scaleSlider.value);
            });
        atlas.scaleChanges.plug(sliderScale);

        /* Configurations for mouse and touch devices.
         */
        let hm = new Hammer.Manager(this.canvas, {
            domEvents: true,
            recognizers: [
                [Hammer.Pan],
                [Hammer.Pinch]
            ]
        });

        /* Users can pinch or use their mouse wheel to change the scale. */
        function preventDefault(e: any) {
            e.preventDefault();
        }
        let wheelScale = $(this.canvas)
            .asEventStream('wheel')
            .doAction(preventDefault)
            .debounceImmediate(10)
            .map((e) => {
                const min  = Number(this.scaleSlider.min);
                const max  = Number(this.scaleSlider.max);
                const step = Number(this.scaleSlider.step);
                return (s0) => {
                    if ((<WheelEvent>e.originalEvent).deltaY > 0) {
                        return Math.min(s0 + step, max);
                    }
                    else {
                        return Math.max(s0 - step, min);
                    }
                };
            });
        atlas.scaleChanges.plug(wheelScale);

        let pinchStart = $(this.canvas).asEventStream('pinchstart').doAction(preventDefault);
        let pinchMove  = $(this.canvas).asEventStream('pinch').doAction(preventDefault).debounceImmediate(50);
        let pinchEnd   = $(this.canvas).asEventStream('pinchend pinchcancel').doAction(preventDefault);
        let pinch      = pinchStart.merge(pinchMove).merge(pinchEnd);
        let pinchScale = Bacon.combineAsArray<any>(this.scale, pinch)
            .withStateMachine(null, (s0: number | null, ev: Bacon.Value<any>) => {
                if (ev.hasValue) {
                    const [s, jqEvent] = <[number, any]>ev.value;
                    const domEvent = jqEvent.originalEvent;
                    const hmEvent  = domEvent.gesture;
                    switch (domEvent.type) {
                    case 'pinchstart':
                        return [s, []];

                    case 'pinch':
                        if (s0) {
                            const min  = Number(this.scaleSlider.min);
                            const max  = Number(this.scaleSlider.max);
                            const step = Number(this.scaleSlider.step);
                            const ds   = hmEvent.scale;
                            const s1   = s0 * ds;
                            const s1q  = Math.round(s1 * (1 / step)) / (1 / step); // quantized
                            const s1qr = Math.min(Math.max(s1q, min), max); // restricted
                            return [s0, [new Bacon.Next(s1qr)]];
                        }
                    }
                }
                return [null, []];
            })
            .map((s: number) => {
                return () => s;
            });
        atlas.scaleChanges.plug(pinchScale);

        /* Users can drag the atlas to scroll it. */
        let panStart = $(this.canvas).asEventStream('panstart').doAction(preventDefault);
        let panMove  = $(this.canvas).asEventStream('pan').doAction(preventDefault).debounceImmediate(10);
        let panEnd   = $(this.canvas).asEventStream('panend pancancel').doAction(preventDefault);
        let pan      = panStart.merge(panMove).merge(panEnd);
        let centerChanges = Bacon.combineAsArray<any>(this.scale, this.center, pan)
            .withStateMachine(null, (c0: Point | null, ev: Bacon.Value<any>) => {
                if (ev.hasValue) {
                    let [scale, c, jqEvent] = <[number, Point, any]>ev.value;
                    let domEvent = jqEvent.originalEvent;
                    let hmEvent  = domEvent.gesture;
                    switch (domEvent.type) {
                    case 'panstart':
                        return [c, []];

                    case 'pan':
                        if (c0) {
                            let ax = this.canvas.width  / $(this.canvas).width();
                            let az = this.canvas.height / $(this.canvas).height();
                            let dx = -hmEvent.deltaX * ax / scale;
                            let dz = -hmEvent.deltaY * az / scale;
                            let c1 = c0.offset(dx, dz).round();
                            return [c0, [new Bacon.Next(c1)]];
                        }
                    }
                }
                return [null, []];
            })
            .map((c: Point) => {
                return () => c;
            });
        atlas.centerChanges.plug(centerChanges);
    }
}
