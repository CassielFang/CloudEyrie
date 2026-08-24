import {
    _decorator,
    Component,
    RigidBody2D, BoxCollider2D, IPhysics2DContact, Contact2DType,
    Input, EventKeyboard, KeyCode, input,
    Vec2,
    log,
} from 'cc';
const { ccclass, property } = _decorator;

@ccclass('QingheController')
export class QingheController extends Component {

    private rigidBody: RigidBody2D | null = null;
    private collider: BoxCollider2D | null = null;

    @property
    private moveSpeed = 5;
    @property
    private jumpSpeed = 20;
    @property
    private maxJumpCount = 2;

    private leftPressed = false;
    private rightPressed = false;
    private spaceTriggered = false;
    private jumpCount = 0;

    private onBeginContact(
        selfCollider: BoxCollider2D,
        otherCollider: BoxCollider2D,
        contact: IPhysics2DContact | null
    ): void {
        log('[Qinghe Controller]: Begin contact: ', otherCollider.node.name);
        this.jumpCount = 0;
    }
    private onEndContact(
        selfCollider: BoxCollider2D,
        otherCollider: BoxCollider2D,
        contact: IPhysics2DContact | null
    ): void {
        log('[Qinghe Controller]: End contact: ', otherCollider.node.name);

    }

    private onKeyDown(event: EventKeyboard): void {
        switch (event.keyCode) {
            case KeyCode.KEY_A: case KeyCode.ARROW_LEFT:
                this.leftPressed = true;
                break;
            case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT:
                this.rightPressed = true;
                break;
            case KeyCode.SPACE:
                this.spaceTriggered = true;
                break;
            default: break;
        }
    }
    private onKeyUp(event: EventKeyboard): void {
        switch (event.keyCode) {
            case KeyCode.KEY_A: case KeyCode.ARROW_LEFT:
                this.leftPressed = false;
                break;
            case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT:
                this.rightPressed = false;
                break;
            case KeyCode.SPACE:
                this.spaceTriggered = false;
                break;
            default: break;
        }
    }

    private handleMovement(): void {
        let horizontal = 0;
        if (this.leftPressed) {
            horizontal += -1;
        }
        if (this.rightPressed) {
            horizontal += 1;
        }

        if (horizontal !== 0 || (this.spaceTriggered && this.jumpCount < this.maxJumpCount)) {
            const velocity = new Vec2(this.rigidBody.linearVelocity);
            if (horizontal !== 0) {
                velocity.x = horizontal * this.moveSpeed;
            }
            if (this.spaceTriggered && this.jumpCount < this.maxJumpCount) {
                velocity.y += this.jumpSpeed;
                this.jumpCount += 1;
                this.spaceTriggered = false;
            }
            this.rigidBody.linearVelocity = velocity;
        }
    }

    protected onLoad(): void {
        this.rigidBody = this.getComponent(RigidBody2D);
        if (!this.rigidBody) {
            throw new Error('[Qinghe Controller] RigidBody2D not found!');
        }

        this.collider = this.getComponent(BoxCollider2D);
        if (!this.collider) {
            throw new Error('[Qinghe Controller] BoxCollider2D not found!');
        }

        this.collider.on(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        this.collider.on(Contact2DType.END_CONTACT, this.onEndContact, this);

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    protected onDestroy(): void {
        this.collider.off('onBeginContact', this.onBeginContact, this);
        this.collider.off('onEndContact', this.onEndContact, this);

        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    protected start(): void {
        log('[Qinghe Controller] start')
    }

    protected update(dt: number): void {
        this.handleMovement();
    }

}


