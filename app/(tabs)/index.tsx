import 'react-native-polyfill-globals/auto'
globalThis.Buffer = require('buffer').Buffer

import {RTCPeerConnection, RTCSessionDescription} from 'react-native-webrtc';
globalThis.RTCPeerConnection = RTCPeerConnection;
globalThis.RTCSessionDescription = RTCSessionDescription;

import {useEffect, useRef, useState} from "react";
import {Alert, Button, Image, StyleSheet} from 'react-native';
import Canvas, {CanvasRenderingContext2D} from 'react-native-canvas';
import Spinner from 'react-native-loading-spinner-overlay';

import {HelloWave} from '@/components/HelloWave';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import {ThemedText} from '@/components/ThemedText';
import {ThemedView} from '@/components/ThemedView';

import {EyePop, Prediction, WorkerEndpoint} from '@eyepop.ai/eyepop';
import EyepopRender2d from '@eyepop.ai/eyepop-render-2d';

import {mediaDevices, RTCView, MediaStream} from 'react-native-webrtc';

import {pino} from 'pino'

const logger = pino({level: 'debug', name: 'eyepop-example'})

const RENDER_RULES = [EyepopRender2d.renderBox()]

export default function HomeScreen() {
    /** Keep an EyePop Endpoint alive for the lifetime of this component */
    const [workerEndpoint, setWorkerEndpoint] = useState<WorkerEndpoint | null>(null);

    /** UI state */
    const [spinner, setSpinner] = useState<string | false>(false);
    const previewCanvas = useRef<Canvas | null>(null);
    const streamView = useRef<RTCView>();
    const [previewWidth, setPreviewWidth] = useState<number>(0);
    const [previewHeight, setPreviewHeight] = useState<number>(0)
    const [localStream, setLocalStream] = useState<MediaStream>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream>(null);
    const [isFrontCam, setIsFrontCam] = useState<boolean>(false);

    const [previewResult, setPreviewResult] = useState<Prediction | null>(null);

    useEffect(() => {
        const { current: canvas } = previewCanvas;
        if (canvas) {
            logger.debug(`height change ${canvas.width}x${canvas.height} => ${previewWidth}x${previewHeight}`)
            canvas.width = previewWidth;
            canvas.height = previewHeight;
        }
        setTimeout(renderPrediction, 100)
    }, [previewHeight])

    /** Initialize an EyePop Endpoint and keeping it alive while this component lives */
    useEffect(() => {
        const endpoint = EyePop.workerEndpoint({
            auth: {secretKey: process.env.EXPO_PUBLIC_EYEPOP_API_KEY || ''},
            popId: process.env.EXPO_PUBLIC_AVOCAI_POP_UUID,
            eyepopUrl: process.env.EXPO_PUBLIC_EYEPOP_URL || undefined,
            logger: logger,
        })
        setSpinner('Connecting to EyePop...')
        endpoint.connect().then(_endpoint => {
            setWorkerEndpoint(_endpoint)
            _endpoint.onIngressEvent(async event => {
                if (event.event == "stream-ready") {
                    try {
                        const results = await _endpoint.process({ingressId: event.ingressId})
                        console.log(`${event.ingressId} start results`);
                        for await (const result of results) {
                            setPreviewResult(result)
                        }
                        console.log(`${event.ingressId} end results`);
                    } catch (e) {
                        console.error(e)
                    }
                }
            })
        }).catch(reason => {
            console.error(reason)
            Alert.alert(`got error ${reason}`)
        }).finally(() => {
            setSpinner(false)
        })
        return () => {
            endpoint.disconnect().catch(reason => {
                console.error(reason);
            }).finally(() => {
                if (endpoint === workerEndpoint) {
                    setWorkerEndpoint(null)
                }
            })
        }
    }, [])

    /** Preview rendering */
    const renderPrediction = () => {
        const { current: canvas } = previewCanvas;
        if (canvas && previewResult) {
            console.log(`render ${JSON.stringify(previewResult)}`)
            canvas.width = previewWidth;
            canvas.height = previewHeight;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            logger.debug(`redraw canvas.width=${canvas.width}, canvas.height=${canvas.height}`)
            // @ts-ignore
            let renderer = EyepopRender2d.renderer(ctx, RENDER_RULES);
            renderer.draw(previewResult);
        }
        if (localStream?._tracks[0]?.readyState === "live") {
            setTimeout(renderPrediction, 100)
        }
    }

    /** WebRTC UI controls */
    const startStream = async () => {
        console.log('startStream');
        let videoTrack
        if (!localStream) {
        const s = await mediaDevices.getUserMedia({ video: true });
        videoTrack = s.getVideoTracks()[0];
        setLocalStream(s);
        setRemoteStream(s);
        if (workerEndpoint) {
            // @ts-ignore
            const liveMedia = await workerEndpoint.liveIngress(s);
            console.log(`got liveMedia ${liveMedia.ingressId()}`);
        }
        } else {
            // switch cameras
            setIsFrontCam(!isFrontCam);
            videoTrack = localStream.getVideoTracks()[0];
	        const constraints = { facingMode: isFrontCam ? 'user' : 'environment' };
        	await videoTrack.applyConstraints(constraints);
        }
        const videoWidth = videoTrack.getSettings().width;
        const videoHeight = videoTrack.getSettings().height;
        setPreviewHeight(previewWidth * videoWidth / videoHeight);
        console.log(`setPreviewHeight(${previewWidth *  videoWidth / videoHeight})`)
        const { current: canvas } = previewCanvas;
        if (canvas) {
            canvas.width = previewWidth;
            canvas.height = previewWidth *  videoWidth / videoHeight;
        }

    };
    const stopStream = async () => {
        console.log('stopStream');
        if (localStream) {
          localStream.release();
          setLocalStream(null);
        }
    };

    return (<ParallaxScrollView
        headerBackgroundColor={{light: '#ffffff', dark: '#1D3D47'}}
        headerImage={<Image
            source={require('@/assets/images/avocai-banner.png')}
            style={styles.reactLogo}
        />}>
        <ThemedView style={styles.titleContainer}>
            <ThemedText type="title">Welcome!</ThemedText>
            <HelloWave/>
        </ThemedView>
        <ThemedView style={styles.stepContainer}>
            <Spinner
                visible={spinner !== false}
                textContent={spinner || ''}
                textStyle={styles.spinnerTextStyle}
            />
            <ThemedText>
                This is a community-based mobile app to collect, share and analyze visual data between Avocado
                Enthusiasts.
                The implementation uses EyePop to manage image datasets, train ML models and run inference in the
                Cloud.
            </ThemedText>
        </ThemedView>
        <ThemedView style={styles.streamContainer}>
            <Button title={localStream? "Switch Camera": "Start"} onPress={startStream}/>
            <Button title="Stop" onPress={stopStream}/>
        </ThemedView>
        <ThemedView style={styles.previewContainer}
                    onLayout={(event) => {console.log(`setPreviewWidth=${event.nativeEvent.layout.width}`); setPreviewWidth(event.nativeEvent.layout.width)}} >
            <RTCView
              ref={streamView}
              streamURL={remoteStream?.toURL()}
              style={Object.assign({}, styles.previewVideo, {height: previewHeight})}
              zorder={0}
              objectFit={"contain"}
            />
            <Canvas ref={previewCanvas}
                    style={Object.assign({}, styles.previewCanvas, {width: previewWidth, height: previewHeight})}/>
        </ThemedView>

    </ParallaxScrollView>);
}

const styles = StyleSheet.create({
    titleContainer: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
    }, stepContainer: {
        gap: 8, marginBottom: 8,
    }, streamContainer: {
        gap: 8, padding: 10,
    }, reactLogo: {
        width: "90%",
        resizeMode: 'contain',
        position: 'relative',
        margin: "5%"
    }, spinnerTextStyle: {
        color: '#FFF',
    },

    previewContainer: {
        flex: 1,
        width: "100%",
        backgroundColor:"red"
    },

    previewCanvas: {
        width: "100%",
        position: 'absolute',
        borderStyle: "solid",
        borderColor: "black",
        zIndex:9999
    },
    previewVideo : {
        width: "100%",
        backgroundColor: "green",
        resizeMode: 'contain',
        position: 'relative',
        zIndex:1,
    },
    preview: {
        fontFamily: "Times New Roman"
    }
});
